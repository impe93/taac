/**
 * Vector Database Manager (Per-Space)
 *
 * Manages sqlite-vec vector database operations:
 * - Stores note embeddings for semantic search
 * - Per-space database isolation
 * - CRUD operations for embeddings
 *
 * Reference: docs/AI_ARCHITECTURE.md section 6.5
 */

import type {
  BM25SearchResult,
  EmbeddingResult,
  ExpandedResult,
  HybridSearchOptions,
  RankedResult,
  SearchResult,
  VectorDocument
} from './types'
import { VectorDBError } from './errors'
import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import { createHash } from 'crypto'

export interface VectorDBConfig {
  dbPath: string
  embeddingDimension: number
}

/**
 * Apply same-note boost: when multiple chunks from the same note appear in results,
 * the note is likely very relevant. Applies a logarithmic boost proportional to chunk count.
 * Pure function — no side effects.
 * Reference: docs/RAG_ARCHITECTURE.md §9.2
 */
export function applySameNoteBoost(results: RankedResult[]): RankedResult[] {
  const noteChunkCount = new Map<string, number>()
  for (const r of results) {
    noteChunkCount.set(r.noteId, (noteChunkCount.get(r.noteId) || 0) + 1)
  }

  return results.map((r) => {
    const count = noteChunkCount.get(r.noteId) || 1
    if (count > 1) {
      // Logarithmic boost: 2 chunks = +0.002, 3 chunks = +0.003, etc.
      return { ...r, rrfScore: r.rrfScore + 0.002 * Math.log2(count) }
    }
    return r
  })
}

/**
 * Apply heuristic boosts for title match and recency, then re-sort by rrfScore descending.
 * Pure function — no side effects.
 * Reference: docs/RAG_ARCHITECTURE.md §9.1
 */
export function applyHeuristicBoosts(results: RankedResult[], query: string): RankedResult[] {
  return results
    .map((result) => {
      let boost = 0

      // 1. TITLE MATCH: if note title contains query terms (> 2 chars), boost per match
      const queryTerms = query.toLowerCase().split(/\s+/)
      const title = ((result.metadata.noteTitle as string) || '').toLowerCase()
      const titleMatches = queryTerms.filter((t) => t.length > 2 && title.includes(t)).length
      if (titleMatches > 0) {
        boost += 0.003 * titleMatches
      }

      // 2. RECENCY: recently modified notes are more relevant
      const updatedAt = result.metadata.updatedAt as string
      if (updatedAt) {
        const daysSinceUpdate = (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24)
        if (daysSinceUpdate < 7) boost += 0.002
        else if (daysSinceUpdate < 30) boost += 0.001
      }

      if (boost === 0) return result
      return { ...result, rrfScore: result.rrfScore + boost }
    })
    .sort((a, b) => b.rrfScore - a.rrfScore)
}

/**
 * Deduplicate overlapping expanded results from the same note.
 * When two expanded chunks overlap (same noteId, intersecting chunkRange),
 * they are merged into one result: the merged range covers both, and
 * the content is re-fetched/re-joined from the union of unique chunks.
 * The result with the higher rrfScore is kept as the base.
 * Pure function — no side effects.
 * Reference: docs/RAG_ARCHITECTURE.md §10.2
 */
export function deduplicateOverlaps(expanded: ExpandedResult[]): ExpandedResult[] {
  if (expanded.length <= 1) return expanded

  // Group by noteId
  const byNote = new Map<string, ExpandedResult[]>()
  for (const e of expanded) {
    const group = byNote.get(e.noteId) || []
    group.push(e)
    byNote.set(e.noteId, group)
  }

  const deduplicated: ExpandedResult[] = []

  for (const [, group] of byNote) {
    // Sort by range start so we can merge overlapping intervals
    group.sort((a, b) => a.chunkRange.from - b.chunkRange.from)

    const merged: ExpandedResult[] = [group[0]]

    for (let i = 1; i < group.length; i++) {
      const prev = merged[merged.length - 1]
      const curr = group[i]

      // Check overlap: curr.from <= prev.to means ranges intersect or are adjacent
      if (curr.chunkRange.from <= prev.chunkRange.to) {
        // Merge: take the higher rrfScore as the base, union the range
        const base = curr.rrfScore > prev.rrfScore ? curr : prev
        const mergedFrom = Math.min(prev.chunkRange.from, curr.chunkRange.from)
        const mergedTo = Math.max(prev.chunkRange.to, curr.chunkRange.to)

        // Re-join content: split both by separator, deduplicate by position
        const prevParts = prev.expandedContent.split('\n\n')
        const currParts = curr.expandedContent.split('\n\n')

        // Build ordered content from the union of chunks.
        // Map each part to its absolute chunk index.
        const contentByIndex = new Map<number, string>()
        for (let j = 0; j < prevParts.length; j++) {
          contentByIndex.set(prev.chunkRange.from + j, prevParts[j])
        }
        for (let j = 0; j < currParts.length; j++) {
          contentByIndex.set(curr.chunkRange.from + j, currParts[j])
        }

        // Sort by index and join
        const sortedIndices = [...contentByIndex.keys()].sort((a, b) => a - b)
        const mergedContent = sortedIndices.map((idx) => contentByIndex.get(idx)!).join('\n\n')

        merged[merged.length - 1] = {
          ...base,
          expandedContent: mergedContent,
          chunkRange: { from: mergedFrom, to: mergedTo }
        }
      } else {
        merged.push(curr)
      }
    }

    deduplicated.push(...merged)
  }

  // Re-sort by rrfScore descending to maintain ranking order
  return deduplicated.sort((a, b) => b.rrfScore - a.rrfScore)
}

export class VectorDBManager {
  private static instances: Map<string, VectorDBManager> = new Map()

  private db: Database.Database | null = null
  private _config: VectorDBConfig
  private initialized: boolean = false

  private constructor(config: VectorDBConfig) {
    this._config = config
  }

  /**
   * Get or create instance for a space
   */
  static getInstance(spaceId: string, dbPath: string): VectorDBManager {
    const existing = this.instances.get(spaceId)
    if (existing) return existing

    const instance = new VectorDBManager({
      dbPath,
      embeddingDimension: 768 // nomic-embed-text dimension
    })
    this.instances.set(spaceId, instance)
    return instance
  }

  /**
   * Initialize database with sqlite-vec extension
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    try {
      // Ensure directory exists
      mkdirSync(dirname(this._config.dbPath), { recursive: true })

      // Create database connection
      this.db = new Database(this._config.dbPath)

      // Load sqlite-vec extension
      sqliteVec.load(this.db)

      // Verify sqlite-vec is loaded
      const versionResult = this.db.prepare('SELECT vec_version() as version').get() as {
        version: string
      }

      console.log(`[VectorDBManager] sqlite-vec version: ${versionResult.version}`)

      // Create embeddings table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS embeddings (
          id TEXT PRIMARY KEY,
          note_id TEXT NOT NULL,
          chunk_index INTEGER NOT NULL,
          content TEXT NOT NULL,
          metadata TEXT,
          embedding_model TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(note_id, chunk_index)
        );

        CREATE INDEX IF NOT EXISTS idx_embeddings_note_id ON embeddings(note_id);
      `)

      // Create indexing status table for content-hash delta indexing
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS indexing_status (
          note_id TEXT PRIMARY KEY,
          content_hash TEXT NOT NULL,
          indexed_at TEXT DEFAULT (datetime('now')),
          chunk_count INTEGER NOT NULL
        );
      `)

      // Migration: add embedding_model column if missing (existing databases)
      try {
        this.db.exec('ALTER TABLE embeddings ADD COLUMN embedding_model TEXT')
      } catch {
        // Column already exists, ignore
      }

      // Migration: add section_id and section_header columns for structure-aware chunking
      await this.migrateSectionFields()

      // Migration: switch vec_embeddings to cosine distance metric
      // Old tables used default L2 distance; cosine is more appropriate for embedding similarity
      await this.migrateToCosinMetric()

      // Create virtual table for vector search using vec0 with cosine distance
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(
          id TEXT PRIMARY KEY,
          embedding float[${this._config.embeddingDimension}] distance_metric=cosine
        );
      `)

      // Migration: create FTS5 table and sync triggers for hybrid search
      await this.migrateFTS5()

      this.initialized = true
      console.log(`[VectorDBManager] Initialized at ${this._config.dbPath}`)
    } catch (error) {
      throw new VectorDBError(
        'initialize',
        error instanceof Error ? error.message : 'Unknown error'
      )
    }
  }

  /**
   * Upsert a document with its embedding
   */
  async upsertDocument(doc: VectorDocument): Promise<void> {
    if (!this.db || !this.initialized) {
      throw new VectorDBError('upsertDocument', 'Database not initialized')
    }

    const id = doc.id || `${doc.noteId}_${doc.chunkIndex}`

    try {
      const transaction = this.db.transaction(() => {
        // Insert metadata into embeddings table
        this.db!.prepare(
          `
          INSERT OR REPLACE INTO embeddings (id, note_id, chunk_index, content, metadata, embedding_model, section_id, section_header)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
        ).run(
          id,
          doc.noteId,
          doc.chunkIndex,
          doc.content,
          JSON.stringify(doc.metadata || {}),
          doc.embeddingModel || null,
          doc.sectionId || null,
          doc.sectionHeader || null
        )

        // Insert vector into vec_embeddings virtual table if embedding is provided
        if (doc.embedding) {
          const vecArray = new Float32Array(doc.embedding)
          this.db!.prepare(
            `
            INSERT OR REPLACE INTO vec_embeddings (id, embedding)
            VALUES (?, ?)
          `
          ).run(id, vecArray)
        }
      })

      transaction()
    } catch (error) {
      throw new VectorDBError(
        'upsertDocument',
        error instanceof Error ? error.message : 'Unknown error'
      )
    }
  }

  /**
   * Store embedding for a note chunk
   */
  async storeEmbedding(embedding: EmbeddingResult): Promise<void> {
    if (!this.db || !this.initialized) {
      throw new VectorDBError('storeEmbedding', 'Database not initialized')
    }

    const id = `${embedding.noteId}_${embedding.chunkIndex}`

    try {
      const transaction = this.db.transaction(() => {
        // Insert metadata into embeddings table
        this.db!.prepare(
          `
          INSERT OR REPLACE INTO embeddings (id, note_id, chunk_index, content, metadata)
          VALUES (?, ?, ?, ?, ?)
        `
        ).run(id, embedding.noteId, embedding.chunkIndex, embedding.text, JSON.stringify({}))

        // Insert vector into vec_embeddings virtual table
        const vecArray = new Float32Array(embedding.embedding)
        this.db!.prepare(
          `
          INSERT OR REPLACE INTO vec_embeddings (id, embedding)
          VALUES (?, ?)
        `
        ).run(id, vecArray)
      })

      transaction()
    } catch (error) {
      throw new VectorDBError(
        'storeEmbedding',
        error instanceof Error ? error.message : 'Unknown error'
      )
    }
  }

  /**
   * Store multiple embeddings in a batch
   */
  async storeEmbeddings(embeddings: EmbeddingResult[]): Promise<void> {
    if (!this.db || !this.initialized) {
      throw new VectorDBError('storeEmbeddings', 'Database not initialized')
    }

    try {
      const insertMetadata = this.db.prepare(`
        INSERT OR REPLACE INTO embeddings (id, note_id, chunk_index, content, metadata)
        VALUES (?, ?, ?, ?, ?)
      `)

      const insertVector = this.db.prepare(`
        INSERT OR REPLACE INTO vec_embeddings (id, embedding)
        VALUES (?, ?)
      `)

      const transaction = this.db.transaction(() => {
        for (const embedding of embeddings) {
          const id = `${embedding.noteId}_${embedding.chunkIndex}`

          insertMetadata.run(
            id,
            embedding.noteId,
            embedding.chunkIndex,
            embedding.text,
            JSON.stringify({})
          )

          const vecArray = new Float32Array(embedding.embedding)
          insertVector.run(id, vecArray)
        }
      })

      transaction()
      console.log(`[VectorDBManager] Stored ${embeddings.length} embeddings`)
    } catch (error) {
      throw new VectorDBError(
        'storeEmbeddings',
        error instanceof Error ? error.message : 'Unknown error'
      )
    }
  }

  /**
   * Search for similar notes using vector similarity
   * @param queryEmbedding - The query vector
   * @param limit - Maximum number of results to return
   * @param noteIds - Optional filter to search only within specific notes
   */
  async search(
    queryEmbedding: number[],
    limit: number = 10,
    noteIds?: string[]
  ): Promise<SearchResult[]> {
    if (!this.db || !this.initialized) {
      throw new VectorDBError('search', 'Database not initialized')
    }

    try {
      const queryVec = new Float32Array(queryEmbedding)

      // If noteIds filter is provided, we need to filter the results
      if (noteIds && noteIds.length > 0) {
        // Search with larger limit first, then filter by noteIds
        const fetchLimit = Math.max(limit * 10, 100) // Fetch more to account for filtering
        const results = this.db
          .prepare(
            `
            SELECT
              v.id,
              v.distance,
              e.note_id,
              e.content,
              e.metadata,
              e.section_id,
              e.section_header
            FROM vec_embeddings v
            JOIN embeddings e ON v.id = e.id
            WHERE v.embedding MATCH ?
              AND k = ?
            ORDER BY v.distance
          `
          )
          .all(queryVec, fetchLimit) as Array<{
          id: string
          distance: number
          note_id: string
          content: string
          metadata: string
          section_id: string | null
          section_header: string | null
        }>

        // Filter by noteIds and limit
        const noteIdSet = new Set(noteIds)
        const filteredResults = results.filter((row) => noteIdSet.has(row.note_id)).slice(0, limit)

        return filteredResults.map((row) => ({
          id: row.id,
          noteId: row.note_id,
          content: row.content,
          distance: row.distance,
          sectionId: row.section_id || undefined,
          sectionHeader: row.section_header || undefined,
          metadata: JSON.parse(row.metadata || '{}')
        }))
      }

      // KNN search using vec0's built-in distance function
      const results = this.db
        .prepare(
          `
          SELECT
            v.id,
            v.distance,
            e.note_id,
            e.content,
            e.metadata,
            e.section_id,
            e.section_header
          FROM vec_embeddings v
          JOIN embeddings e ON v.id = e.id
          WHERE v.embedding MATCH ?
            AND k = ?
          ORDER BY v.distance
        `
        )
        .all(queryVec, limit) as Array<{
        id: string
        distance: number
        note_id: string
        content: string
        metadata: string
        section_id: string | null
        section_header: string | null
      }>

      return results.map((row) => ({
        id: row.id,
        noteId: row.note_id,
        content: row.content,
        distance: row.distance,
        sectionId: row.section_id || undefined,
        sectionHeader: row.section_header || undefined,
        metadata: JSON.parse(row.metadata || '{}')
      }))
    } catch (error) {
      throw new VectorDBError('search', error instanceof Error ? error.message : 'Unknown error')
    }
  }

  /**
   * Sanitize a query string for FTS5 MATCH syntax.
   * Wraps each token in double quotes to treat them as literals,
   * preventing FTS5 operator characters (*, +, -, ^, :, etc.) from
   * being interpreted as syntax.
   */
  private sanitizeFTS5Query(query: string): string {
    // Split on whitespace, filter empty tokens, escape internal double quotes, wrap each in quotes
    const tokens = query
      .split(/\s+/)
      .filter((t) => t.length > 0)
      .map((t) => `"${t.replace(/"/g, '""')}"`)

    return tokens.join(' ')
  }

  /**
   * Search for matching chunks using BM25 keyword search via FTS5.
   *
   * @param query - The search query (natural language)
   * @param limit - Maximum number of results to return
   * @param noteIds - Optional filter to search only within specific notes
   * @returns Array of BM25SearchResult. The bm25Score is the raw FTS5 rank
   *          (negative; more negative = more relevant).
   */
  async bm25Search(
    query: string,
    limit: number = 10,
    noteIds?: string[]
  ): Promise<BM25SearchResult[]> {
    if (!this.db || !this.initialized) {
      return []
    }

    const sanitized = this.sanitizeFTS5Query(query)
    if (sanitized.length === 0) return []

    try {
      let results: Array<{
        id: string
        note_id: string
        content: string
        section_id: string | null
        section_header: string | null
        metadata: string
        bm25_score: number
      }>

      if (noteIds && noteIds.length > 0) {
        const placeholders = noteIds.map(() => '?').join(', ')
        results = this.db
          .prepare(
            `
            SELECT e.id, e.note_id, e.content, e.section_id, e.section_header, e.metadata,
                   rank AS bm25_score
            FROM embeddings_fts
            JOIN embeddings e ON embeddings_fts.rowid = e.rowid
            WHERE embeddings_fts MATCH ?
              AND e.note_id IN (${placeholders})
            ORDER BY rank
            LIMIT ?
          `
          )
          .all(sanitized, ...noteIds, limit) as typeof results
      } else {
        results = this.db
          .prepare(
            `
            SELECT e.id, e.note_id, e.content, e.section_id, e.section_header, e.metadata,
                   rank AS bm25_score
            FROM embeddings_fts
            JOIN embeddings e ON embeddings_fts.rowid = e.rowid
            WHERE embeddings_fts MATCH ?
            ORDER BY rank
            LIMIT ?
          `
          )
          .all(sanitized, limit) as typeof results
      }

      return results.map((row) => ({
        id: row.id,
        noteId: row.note_id,
        content: row.content,
        sectionId: row.section_id || undefined,
        sectionHeader: row.section_header || undefined,
        metadata: JSON.parse(row.metadata || '{}'),
        bm25Score: row.bm25_score
      }))
    } catch (error) {
      // Graceful fallback: log and return empty array for invalid queries or empty FTS table
      console.warn(
        '[VectorDBManager] BM25 search failed:',
        error instanceof Error ? error.message : error
      )
      return []
    }
  }

  /**
   * Hybrid search combining vector KNN and BM25 keyword search via Reciprocal Rank Fusion.
   * Reference: docs/RAG_ARCHITECTURE.md §8.3–8.4
   *
   * @param options - Search configuration
   * @returns Top results ranked by RRF score (descending)
   */
  hybridSearch(options: HybridSearchOptions): RankedResult[] {
    if (!this.db || !this.initialized) {
      throw new VectorDBError('hybridSearch', 'Database not initialized')
    }

    const {
      query,
      queryEmbedding,
      limit,
      vectorWeight = 1.0,
      bm25Weight = 0.7,
      rrfK = 60,
      noteIds
    } = options

    // --- Step 1: Vector KNN search (k=20) ---
    const vectorK = 20

    type VectorRow = {
      id: string
      distance: number
      note_id: string
      chunk_index: number
      content: string
      section_id: string | null
      section_header: string | null
      metadata: string
    }

    let vectorResults: VectorRow[]

    if (noteIds && noteIds.length > 0) {
      // Fetch extra results to account for noteId filtering
      const fetchLimit = Math.max(vectorK * 10, 100)
      const allResults = this.db
        .prepare(
          `
          SELECT v.id, v.distance, e.note_id, e.chunk_index, e.content,
                 e.section_id, e.section_header, e.metadata
          FROM vec_embeddings v
          JOIN embeddings e ON v.id = e.id
          WHERE v.embedding MATCH ? AND k = ?
          ORDER BY v.distance
        `
        )
        .all(queryEmbedding, fetchLimit) as VectorRow[]

      const noteIdSet = new Set(noteIds)
      vectorResults = allResults.filter((r) => noteIdSet.has(r.note_id)).slice(0, vectorK)
    } else {
      vectorResults = this.db
        .prepare(
          `
          SELECT v.id, v.distance, e.note_id, e.chunk_index, e.content,
                 e.section_id, e.section_header, e.metadata
          FROM vec_embeddings v
          JOIN embeddings e ON v.id = e.id
          WHERE v.embedding MATCH ? AND k = ?
          ORDER BY v.distance
        `
        )
        .all(queryEmbedding, vectorK) as VectorRow[]
    }

    // Pre-filter: exclude chunks with cosine distance > 1.2
    vectorResults = vectorResults.filter((r) => r.distance <= 1.2)

    // --- Step 2: BM25 search (limit=20) ---
    const bm25Limit = 20

    type BM25Row = {
      id: string
      note_id: string
      chunk_index: number
      content: string
      section_id: string | null
      section_header: string | null
      metadata: string
      bm25_score: number
    }

    let bm25Results: BM25Row[] = []

    const sanitized = this.sanitizeFTS5Query(query)
    if (sanitized.length > 0) {
      try {
        if (noteIds && noteIds.length > 0) {
          const placeholders = noteIds.map(() => '?').join(', ')
          bm25Results = this.db
            .prepare(
              `
              SELECT e.id, e.note_id, e.chunk_index, e.content,
                     e.section_id, e.section_header, e.metadata,
                     rank AS bm25_score
              FROM embeddings_fts
              JOIN embeddings e ON embeddings_fts.rowid = e.rowid
              WHERE embeddings_fts MATCH ?
                AND e.note_id IN (${placeholders})
              ORDER BY rank
              LIMIT ?
            `
            )
            .all(sanitized, ...noteIds, bm25Limit) as BM25Row[]
        } else {
          bm25Results = this.db
            .prepare(
              `
              SELECT e.id, e.note_id, e.chunk_index, e.content,
                     e.section_id, e.section_header, e.metadata,
                     rank AS bm25_score
              FROM embeddings_fts
              JOIN embeddings e ON embeddings_fts.rowid = e.rowid
              WHERE embeddings_fts MATCH ?
              ORDER BY rank
              LIMIT ?
            `
            )
            .all(sanitized, bm25Limit) as BM25Row[]
        }
      } catch {
        // FTS5 table empty or query invalid — fallback to vector-only
        bm25Results = []
      }
    }

    // --- Step 3: Build rank maps (rank is 1-based) ---
    const vectorRankMap = new Map<string, { rank: number; distance: number; data: VectorRow }>()
    vectorResults.forEach((r, i) => {
      vectorRankMap.set(r.id, { rank: i + 1, distance: r.distance, data: r })
    })

    const bm25RankMap = new Map<string, { rank: number; data: BM25Row }>()
    bm25Results.forEach((r, i) => {
      bm25RankMap.set(r.id, { rank: i + 1, data: r })
    })

    // --- Step 4: Merge and compute RRF scores ---
    const allIds = new Set([...vectorRankMap.keys(), ...bm25RankMap.keys()])
    const fusedResults: RankedResult[] = []

    for (const id of allIds) {
      const vecEntry = vectorRankMap.get(id)
      const bm25Entry = bm25RankMap.get(id)

      // RRF_score(doc) = Σ (weight_i / (k + rank_i(doc)))
      let rrfScore = 0
      if (vecEntry) {
        rrfScore += vectorWeight / (rrfK + vecEntry.rank)
      }
      if (bm25Entry) {
        rrfScore += bm25Weight / (rrfK + bm25Entry.rank)
      }

      // Get metadata from whichever source has it (prefer vector for distance)
      const data = vecEntry?.data ?? bm25Entry!.data

      fusedResults.push({
        id,
        noteId: data.note_id,
        chunkIndex: data.chunk_index,
        content: data.content,
        sectionId: data.section_id,
        sectionHeader: data.section_header,
        metadata: JSON.parse(data.metadata || '{}'),
        rrfScore,
        relevancePercent: 0, // Computed in Step 6 after sorting
        vectorDistance: vecEntry?.distance ?? null,
        bm25Rank: bm25Entry?.rank ?? null
      })
    }

    // --- Step 5: Apply heuristic boosts ---
    // Pipeline: same-note boost → title match + recency boost → re-sort → top N
    const boosted = applyHeuristicBoosts(applySameNoteBoost(fusedResults), query)
    const topN = boosted.slice(0, limit)

    if (topN.length === 0) return []

    // --- Step 6: Compute relevancePercent and apply dynamic threshold ---
    const maxRRF = Math.max(...topN.map((r) => r.rrfScore))

    return topN
      .filter((r) => r.rrfScore >= maxRRF * 0.25) // Dynamic threshold: 25% of best
      .map((r) => ({
        ...r,
        relevancePercent: Math.round((r.rrfScore / maxRRF) * 100)
      }))
  }

  /**
   * Delete all documents/embeddings for a note
   */
  async deleteDocumentsForNote(noteId: string): Promise<void> {
    if (!this.db || !this.initialized) {
      throw new VectorDBError('deleteDocumentsForNote', 'Database not initialized')
    }

    try {
      const transaction = this.db.transaction(() => {
        // Get all IDs for this note
        const ids = this.db!.prepare(
          `
          SELECT id FROM embeddings WHERE note_id = ?
        `
        ).all(noteId) as Array<{ id: string }>

        // Delete from vec_embeddings
        const deleteVec = this.db!.prepare('DELETE FROM vec_embeddings WHERE id = ?')
        for (const { id } of ids) {
          deleteVec.run(id)
        }

        // Delete from embeddings table
        this.db!.prepare('DELETE FROM embeddings WHERE note_id = ?').run(noteId)

        // Delete from indexing status
        this.db!.prepare('DELETE FROM indexing_status WHERE note_id = ?').run(noteId)
      })

      transaction()
      console.log(`[VectorDBManager] Deleted embeddings for note ${noteId}`)
    } catch (error) {
      throw new VectorDBError(
        'deleteDocumentsForNote',
        error instanceof Error ? error.message : 'Unknown error'
      )
    }
  }

  /**
   * Delete embeddings for a note (alias for deleteDocumentsForNote)
   * @deprecated Use deleteDocumentsForNote instead
   */
  async deleteNoteEmbeddings(noteId: string): Promise<void> {
    return this.deleteDocumentsForNote(noteId)
  }

  /**
   * Check if a note is indexed
   */
  async isNoteIndexed(noteId: string): Promise<boolean> {
    if (!this.db || !this.initialized) {
      return false
    }

    try {
      const result = this.db
        .prepare('SELECT COUNT(*) as count FROM embeddings WHERE note_id = ?')
        .get(noteId) as { count: number }

      return result.count > 0
    } catch {
      return false
    }
  }

  /**
   * Get all indexed note IDs
   */
  async getIndexedNoteIds(): Promise<string[]> {
    if (!this.db || !this.initialized) {
      return []
    }

    try {
      const results = this.db.prepare('SELECT DISTINCT note_id FROM embeddings').all() as Array<{
        note_id: string
      }>

      return results.map((row) => row.note_id)
    } catch {
      return []
    }
  }

  /**
   * Get document count for statistics
   */
  async getDocumentCount(): Promise<number> {
    if (!this.db || !this.initialized) {
      return 0
    }

    try {
      const result = this.db.prepare('SELECT COUNT(*) as count FROM embeddings').get() as {
        count: number
      }

      return result.count
    } catch {
      return 0
    }
  }

  /**
   * Get embedding count for statistics (alias for getDocumentCount)
   * @deprecated Use getDocumentCount instead
   */
  async getEmbeddingCount(): Promise<number> {
    return this.getDocumentCount()
  }

  /**
   * Get the embedding model used for stored embeddings
   * Returns null if no embeddings exist or model is not tracked
   */
  async getStoredEmbeddingModel(): Promise<string | null> {
    if (!this.db || !this.initialized) {
      return null
    }

    try {
      const result = this.db
        .prepare('SELECT embedding_model FROM embeddings WHERE embedding_model IS NOT NULL LIMIT 1')
        .get() as { embedding_model: string } | undefined

      return result?.embedding_model || null
    } catch {
      return null
    }
  }

  // ===========================================================================
  // Content-Hash Delta Indexing
  // ===========================================================================

  /**
   * Compute SHA-256 hash of content
   */
  private computeHash(content: string): string {
    return createHash('sha256').update(content).digest('hex')
  }

  /**
   * Check if a note needs re-indexing by comparing content hash
   * Returns true if the note has never been indexed or its content has changed
   */
  isNoteStale(noteId: string, currentContent: string): boolean {
    if (!this.db || !this.initialized) return true

    try {
      const row = this.db
        .prepare('SELECT content_hash FROM indexing_status WHERE note_id = ?')
        .get(noteId) as { content_hash: string } | undefined

      if (!row) return true

      return row.content_hash !== this.computeHash(currentContent)
    } catch {
      return true
    }
  }

  /**
   * Update or insert indexing status for a note
   */
  updateIndexingStatus(noteId: string, contentHash: string, chunkCount: number): void {
    if (!this.db || !this.initialized) return

    this.db
      .prepare(
        `
        INSERT OR REPLACE INTO indexing_status (note_id, content_hash, chunk_count)
        VALUES (?, ?, ?)
      `
      )
      .run(noteId, contentHash, chunkCount)
  }

  /**
   * Get indexing status for a note
   */
  getIndexingStatus(
    noteId: string
  ): { contentHash: string; indexedAt: string; chunkCount: number } | null {
    if (!this.db || !this.initialized) return null

    try {
      const row = this.db
        .prepare(
          'SELECT content_hash, indexed_at, chunk_count FROM indexing_status WHERE note_id = ?'
        )
        .get(noteId) as
        | { content_hash: string; indexed_at: string; chunk_count: number }
        | undefined

      if (!row) return null

      return {
        contentHash: row.content_hash,
        indexedAt: row.indexed_at,
        chunkCount: row.chunk_count
      }
    } catch {
      return null
    }
  }

  /**
   * Clear all embeddings
   */
  async clear(): Promise<void> {
    if (!this.db || !this.initialized) {
      return
    }

    try {
      const transaction = this.db.transaction(() => {
        this.db!.exec('DELETE FROM vec_embeddings')
        this.db!.exec('DELETE FROM embeddings')
        this.db!.exec('DELETE FROM indexing_status')
      })

      transaction()
      console.log('[VectorDBManager] Cleared all embeddings and indexing status')
    } catch (error) {
      throw new VectorDBError('clear', error instanceof Error ? error.message : 'Unknown error')
    }
  }

  // ===========================================================================
  // Window Expansion (Multi-Chunk Retrieval)
  // Reference: docs/RAG_ARCHITECTURE.md §10.2
  // ===========================================================================

  /**
   * Retrieve chunks for a note within a chunk_index range.
   * Used by expandWithWindow to fetch adjacent chunks.
   */
  getChunksByNoteAndRange(
    noteId: string,
    fromIndex: number,
    toIndex: number
  ): {
    id: string
    chunkIndex: number
    content: string
    sectionId: string | null
    sectionHeader: string | null
  }[] {
    if (!this.db || !this.initialized) return []

    try {
      const rows = this.db
        .prepare(
          `
          SELECT id, chunk_index, content, section_id, section_header
          FROM embeddings
          WHERE note_id = ? AND chunk_index BETWEEN ? AND ?
          ORDER BY chunk_index
        `
        )
        .all(noteId, fromIndex, toIndex) as Array<{
        id: string
        chunk_index: number
        content: string
        section_id: string | null
        section_header: string | null
      }>

      return rows.map((r) => ({
        id: r.id,
        chunkIndex: r.chunk_index,
        content: r.content,
        sectionId: r.section_id,
        sectionHeader: r.section_header
      }))
    } catch (error) {
      console.warn(
        '[VectorDBManager] getChunksByNoteAndRange failed:',
        error instanceof Error ? error.message : error
      )
      return []
    }
  }

  /**
   * Expand matched chunks by retrieving adjacent chunks within a window.
   * For each matched chunk at index N, fetches chunks from N-windowSize to N+windowSize,
   * concatenates them in order, then deduplicates overlapping ranges.
   *
   * Reference: docs/RAG_ARCHITECTURE.md §10.2 — Livello 1: Window Expansion
   */
  expandWithWindow(matchedChunks: RankedResult[], windowSize: number = 1): ExpandedResult[] {
    const expanded: ExpandedResult[] = []

    for (const chunk of matchedChunks) {
      const fromIndex = Math.max(0, chunk.chunkIndex - windowSize)
      const toIndex = chunk.chunkIndex + windowSize

      const adjacentChunks = this.getChunksByNoteAndRange(chunk.noteId, fromIndex, toIndex)

      const combinedContent = adjacentChunks.map((c) => c.content).join('\n\n')

      // Determine effective range from actually retrieved chunks
      const effectiveFrom =
        adjacentChunks.length > 0 ? adjacentChunks[0].chunkIndex : chunk.chunkIndex
      const effectiveTo =
        adjacentChunks.length > 0
          ? adjacentChunks[adjacentChunks.length - 1].chunkIndex
          : chunk.chunkIndex

      expanded.push({
        ...chunk,
        expandedContent: combinedContent,
        chunkRange: { from: effectiveFrom, to: effectiveTo }
      })
    }

    return deduplicateOverlaps(expanded)
  }

  /**
   * Add section_id and section_header columns to embeddings table
   * for structure-aware chunking and section-based retrieval.
   */
  private async migrateSectionFields(): Promise<void> {
    if (!this.db) return

    // Ensure db_meta exists (may already exist from cosine migration)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS db_meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `)

    const meta = this.db
      .prepare("SELECT value FROM db_meta WHERE key = 'migration_section_fields'")
      .get() as { value: string } | undefined

    if (meta?.value === 'done') return

    try {
      // Add columns (SQLite ALTER TABLE ADD COLUMN is always safe)
      try {
        this.db.exec('ALTER TABLE embeddings ADD COLUMN section_id TEXT')
      } catch {
        // Column already exists
      }

      try {
        this.db.exec('ALTER TABLE embeddings ADD COLUMN section_header TEXT')
      } catch {
        // Column already exists
      }

      // Create index for section-based queries
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_embeddings_section_id ON embeddings(section_id)')

      // Record the migration
      this.db
        .prepare(
          "INSERT OR REPLACE INTO db_meta (key, value) VALUES ('migration_section_fields', 'done')"
        )
        .run()

      console.log('[VectorDBManager] Migration: added section_id and section_header columns')
    } catch (error) {
      console.error('[VectorDBManager] Section fields migration failed:', error)
    }
  }

  /**
   * Migrate vec_embeddings from L2 to cosine distance metric
   * Drops the old table so it gets recreated with the correct metric.
   * Embeddings data must be re-indexed after this migration.
   */
  private async migrateToCosinMetric(): Promise<void> {
    if (!this.db) return

    try {
      // Check if vec_embeddings exists AND uses the old L2 metric
      // We detect this by checking a db_meta table for the distance metric version
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS db_meta (
          key TEXT PRIMARY KEY,
          value TEXT
        );
      `)

      const meta = this.db
        .prepare("SELECT value FROM db_meta WHERE key = 'distance_metric'")
        .get() as { value: string } | undefined

      if (meta?.value === 'cosine') {
        return // Already migrated
      }

      // Drop old vec_embeddings (uses L2 distance) and clear orphaned metadata
      console.log('[VectorDBManager] Migrating to cosine distance metric...')
      this.db.exec('DROP TABLE IF EXISTS vec_embeddings')
      this.db.exec('DELETE FROM embeddings')

      // Record the migration
      this.db
        .prepare("INSERT OR REPLACE INTO db_meta (key, value) VALUES ('distance_metric', 'cosine')")
        .run()

      console.log('[VectorDBManager] Migration complete. Notes need to be re-indexed.')
    } catch (error) {
      console.error('[VectorDBManager] Migration failed:', error)
    }
  }

  /**
   * Create FTS5 virtual table and sync triggers for hybrid search (BM25).
   * Uses content-sync mode: FTS5 reads content from the `embeddings` table via rowid.
   * Triggers keep FTS5 in sync on INSERT, DELETE, and UPDATE.
   */
  private async migrateFTS5(): Promise<void> {
    if (!this.db) return

    const meta = this.db.prepare("SELECT value FROM db_meta WHERE key = 'migration_fts5'").get() as
      | { value: string }
      | undefined

    if (meta?.value === 'done') return

    try {
      // Create FTS5 virtual table (content-sync with embeddings)
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS embeddings_fts USING fts5(
          content,
          note_title,
          content='embeddings',
          content_rowid='rowid',
          tokenize='unicode61'
        );
      `)

      // Sync trigger: INSERT — index new chunk into FTS5
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS embeddings_ai AFTER INSERT ON embeddings BEGIN
          INSERT INTO embeddings_fts(rowid, content, note_title)
          VALUES (new.rowid, new.content, json_extract(new.metadata, '$.noteTitle'));
        END;
      `)

      // Sync trigger: DELETE — remove chunk from FTS5
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS embeddings_ad AFTER DELETE ON embeddings BEGIN
          INSERT INTO embeddings_fts(embeddings_fts, rowid, content, note_title)
          VALUES ('delete', old.rowid, old.content, json_extract(old.metadata, '$.noteTitle'));
        END;
      `)

      // Sync trigger: UPDATE — delete old entry + insert updated entry
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS embeddings_au AFTER UPDATE ON embeddings BEGIN
          INSERT INTO embeddings_fts(embeddings_fts, rowid, content, note_title)
          VALUES ('delete', old.rowid, old.content, json_extract(old.metadata, '$.noteTitle'));
          INSERT INTO embeddings_fts(rowid, content, note_title)
          VALUES (new.rowid, new.content, json_extract(new.metadata, '$.noteTitle'));
        END;
      `)

      // If embeddings has data but FTS5 is empty, rebuild the FTS index
      const embeddingsCount = this.db.prepare('SELECT COUNT(*) as count FROM embeddings').get() as {
        count: number
      }

      if (embeddingsCount.count > 0) {
        const ftsCount = this.db.prepare('SELECT COUNT(*) as count FROM embeddings_fts').get() as {
          count: number
        }

        if (ftsCount.count === 0) {
          console.log(
            '[VectorDBManager] FTS5 table empty with existing embeddings, rebuilding index...'
          )
          this.db.exec("INSERT INTO embeddings_fts(embeddings_fts) VALUES('rebuild')")
        }
      }

      // Record migration
      this.db
        .prepare("INSERT OR REPLACE INTO db_meta (key, value) VALUES ('migration_fts5', 'done')")
        .run()

      console.log('[VectorDBManager] Migration: created FTS5 table and sync triggers')
    } catch (error) {
      console.error('[VectorDBManager] FTS5 migration failed:', error)
    }
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close()
      this.db = null
    }
    this.initialized = false
    console.log('[VectorDBManager] Database connection closed')
  }

  /**
   * Remove instance for a space (used when space is deleted)
   */
  static removeInstance(spaceId: string): void {
    const instance = this.instances.get(spaceId)
    if (instance) {
      instance.close()
      this.instances.delete(spaceId)
    }
  }

  /**
   * Get database configuration
   */
  getConfig(): VectorDBConfig {
    return this._config
  }

  /**
   * Check if database is initialized
   */
  isInitialized(): boolean {
    return this.initialized
  }
}
