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

import type { EmbeddingResult, SearchResult, VectorDocument } from './types'
import { VectorDBError } from './errors'
import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import { mkdirSync } from 'fs'
import { dirname } from 'path'

export interface VectorDBConfig {
  dbPath: string
  embeddingDimension: number
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

      // Migration: add embedding_model column if missing (existing databases)
      try {
        this.db.exec('ALTER TABLE embeddings ADD COLUMN embedding_model TEXT')
      } catch {
        // Column already exists, ignore
      }

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
          INSERT OR REPLACE INTO embeddings (id, note_id, chunk_index, content, metadata, embedding_model)
          VALUES (?, ?, ?, ?, ?, ?)
        `
        ).run(
          id,
          doc.noteId,
          doc.chunkIndex,
          doc.content,
          JSON.stringify(doc.metadata || {}),
          doc.embeddingModel || null
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
              e.metadata
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
        }>

        // Filter by noteIds and limit
        const noteIdSet = new Set(noteIds)
        const filteredResults = results.filter((row) => noteIdSet.has(row.note_id)).slice(0, limit)

        return filteredResults.map((row) => ({
          id: row.id,
          noteId: row.note_id,
          content: row.content,
          distance: row.distance,
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
            e.metadata
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
      }>

      return results.map((row) => ({
        id: row.id,
        noteId: row.note_id,
        content: row.content,
        distance: row.distance,
        metadata: JSON.parse(row.metadata || '{}')
      }))
    } catch (error) {
      throw new VectorDBError('search', error instanceof Error ? error.message : 'Unknown error')
    }
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
      })

      transaction()
      console.log('[VectorDBManager] Cleared all embeddings')
    } catch (error) {
      throw new VectorDBError('clear', error instanceof Error ? error.message : 'Unknown error')
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

      console.log(
        '[VectorDBManager] Migration complete. Notes need to be re-indexed.'
      )
    } catch (error) {
      console.error('[VectorDBManager] Migration failed:', error)
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
