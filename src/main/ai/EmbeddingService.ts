/**
 * Embedding Service
 *
 * Handles embedding generation and note indexing for RAG:
 * - Text chunking with overlap and paragraph awareness
 * - Embedding generation using AIManager
 * - Note indexing into VectorDB
 * - Batch processing for efficiency
 *
 * Reference: docs/AI_ARCHITECTURE.md section 6.7
 */

import type { AIManager } from './AIManager'
import type { VectorDBManager } from './VectorDBManager'
import type { LlamaModel, LlamaEmbeddingContext } from 'node-llama-cpp'
import type {
  EmbeddingResult,
  ChunkingOptions,
  StructuredChunk,
  StructureAwareChunkingOptions
} from './types'
import { DEFAULT_CHUNKING_OPTIONS, DEFAULT_STRUCTURE_AWARE_OPTIONS } from './types'
import { EmbeddingFailedError, AINotInitializedError } from './errors'
import { v4 as uuidv4 } from 'uuid'
import { createHash } from 'crypto'

/**
 * Extended chunking options with token-based limits
 */
export interface ExtendedChunkingOptions extends ChunkingOptions {
  /** Minimum chunk size in tokens to keep (avoids tiny fragments) */
  minChunkTokens?: number
}

/**
 * A Markdown section parsed from headers
 */
interface ParsedSection {
  header: string // Header text without # markers, '' for intro
  content: string // Full section content including the header line
  startOffset: number
  endOffset: number
}

/**
 * A text chunk with position metadata
 */
export interface TextChunk {
  text: string
  index: number
  startOffset: number
  endOffset: number
}

/**
 * Note structure for indexing
 * Matches the Note interface from preload/types.ts
 */
export interface IndexableNote {
  id: string
  folderId: string
  folderPath?: string // Full hierarchical folder path for semantic search (e.g. "Projects / Client A / Meetings")
  content: string // Markdown content
  title: string
  createdAt: string
  updatedAt: string
}

/**
 * Default extended chunking options (token-based)
 */
const DEFAULT_EXTENDED_OPTIONS: ExtendedChunkingOptions = {
  ...DEFAULT_CHUNKING_OPTIONS,
  minChunkTokens: 10
}

/**
 * Embedding Service
 *
 * Manages embedding generation and note indexing using AIManager
 * and VectorDBManager for RAG functionality.
 */
export class EmbeddingService {
  private aiManager: AIManager
  private embeddingModelId: string = 'nomic-embed-text-v2-moe'
  private embeddingContext: LlamaEmbeddingContext | null = null
  private cachedModelId: string | null = null

  /**
   * Create an EmbeddingService instance
   * @param aiManager - The AIManager instance for embedding generation
   */
  constructor(aiManager: AIManager) {
    this.aiManager = aiManager

    // Invalidate cached context when the embedding model is unloaded
    this.aiManager.onModelUnload((modelId: string) => {
      if (modelId === this.embeddingModelId) {
        this.invalidateContext()
      }
    })
  }

  /**
   * Set the embedding model to use
   * @param modelId - The model ID from ModelRegistry
   */
  setEmbeddingModel(modelId: string): void {
    if (this.embeddingModelId !== modelId) {
      this.invalidateContext()
    }
    this.embeddingModelId = modelId
  }

  /**
   * Get the current embedding model ID
   */
  getEmbeddingModel(): string {
    return this.embeddingModelId
  }

  /**
   * Get or create the cached LlamaEmbeddingContext
   *
   * Reuses the existing context if the model hasn't changed.
   * Creates a new one via AIManager if the context doesn't exist
   * or the embedding model has been switched.
   */
  private async getOrCreateContext(): Promise<LlamaEmbeddingContext> {
    if (!this.aiManager.isInitialized()) {
      throw new AINotInitializedError()
    }

    if (!this.embeddingContext || this.cachedModelId !== this.embeddingModelId) {
      this.embeddingContext = await this.aiManager.getEmbeddingContext(this.embeddingModelId)
      this.cachedModelId = this.embeddingModelId
    }

    return this.embeddingContext
  }

  /**
   * Invalidate the cached embedding context
   *
   * Should be called when the embedding model is unloaded or changed.
   * The next embedding call will create a fresh context.
   */
  invalidateContext(): void {
    this.embeddingContext = null
    this.cachedModelId = null
  }

  /**
   * Generate embedding for a single text (no task prefix)
   * @param text - The text to embed
   * @returns The embedding vector as returned by the model
   */
  async embedText(text: string): Promise<number[]> {
    const context = await this.getOrCreateContext()
    const embedding = await context.getEmbeddingFor(text)
    return [...embedding.vector]
  }

  /**
   * Generate embedding with a task-specific prefix
   * nomic-embed-text-v2-moe requires 'search_document' / 'search_query' prefixes
   * for proper asymmetric search quality
   */
  private async embedWithPrefix(prefix: string, text: string): Promise<number[]> {
    const context = await this.getOrCreateContext()
    const prefixedText = `${prefix}: ${text}`
    const embedding = await context.getEmbeddingFor(prefixedText)
    return [...embedding.vector]
  }

  /**
   * Generate embedding for a document chunk (uses 'search_document' prefix)
   * @param text - The document text to embed
   * @returns The embedding vector
   */
  async embedDocument(text: string): Promise<number[]> {
    return this.embedWithPrefix('search_document', text)
  }

  /**
   * Generate embeddings for multiple texts
   * @param texts - Array of texts to embed
   * @returns Array of embedding vectors (same order as input)
   */
  async embedTexts(texts: string[]): Promise<number[][]> {
    const context = await this.getOrCreateContext()
    const embeddings: number[][] = []

    for (const text of texts) {
      const embedding = await context.getEmbeddingFor(text)
      embeddings.push([...embedding.vector])
    }

    return embeddings
  }

  /**
   * Build the contextual header text used for embedding generation.
   *
   * Prepends note title (and optionally section header) to the chunk text
   * so the embedding model has context about provenance. The original chunk
   * text is still stored in the database for display / LLM context.
   *
   * Format: Note: "{noteTitle}" | Section: "{sectionHeader}" | {chunkText}
   *
   * @param chunkText - The raw chunk text
   * @param noteTitle - Title of the parent note
   * @param sectionHeader - Optional Markdown section header
   * @returns The enriched text to pass to embedDocument()
   */
  buildEmbeddingText(
    chunkText: string,
    noteTitle: string,
    sectionHeader?: string,
    folderPath?: string
  ): string {
    const parts: string[] = []

    if (folderPath) {
      parts.push(`Path: "${folderPath}"`)
    }

    parts.push(`Note: "${noteTitle}"`)

    if (sectionHeader) {
      parts.push(`Section: "${sectionHeader}"`)
    }

    parts.push(chunkText)
    return parts.join(' | ')
  }

  /**
   * Index a note into the vector database
   *
   * This method:
   * 1. Checks content hash — skips if note is unchanged
   * 2. Deletes existing embeddings for the note
   * 3. Extracts text from Markdown content
   * 4. Chunks the text with overlap
   * 5. Generates embeddings for each chunk
   * 6. Stores in VectorDB and updates indexing status
   *
   * @param note - The note to index
   * @param vectorDB - The VectorDBManager instance
   * @param options - Optional chunking configuration
   * @returns true if the note was indexed, false if skipped (unchanged)
   */
  async indexNote(
    note: IndexableNote,
    vectorDB: VectorDBManager,
    _options: ExtendedChunkingOptions = DEFAULT_EXTENDED_OPTIONS
  ): Promise<boolean> {
    try {
      // Check if note content or folder path has changed since last indexing
      const hashInput = note.content + '||' + (note.folderPath ?? '')
      if (!vectorDB.isNoteStale(note.id, hashInput)) {
        console.log(`[EmbeddingService] Note ${note.id} is unchanged, skipping`)
        return false
      }

      const contentHash = createHash('sha256').update(hashInput).digest('hex')

      // Delete existing chunks for this note
      await vectorDB.deleteDocumentsForNote(note.id)

      // Extract text from Markdown content
      const textContent = this.extractTextFromMarkdown(note.content)

      if (!textContent.trim()) {
        console.log(`[EmbeddingService] Note ${note.id} has no text content, skipping indexing`)
        vectorDB.updateIndexingStatus(note.id, contentHash, 0)
        return true
      }

      // Chunk the content with structure-aware section splitting
      const chunks = await this.structureAwareChunk(textContent, note.id)

      if (chunks.length === 0) {
        console.log(`[EmbeddingService] Note ${note.id} produced no valid chunks, skipping`)
        vectorDB.updateIndexingStatus(note.id, contentHash, 0)
        return true
      }

      // Generate embeddings and store each chunk
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]
        // Use contextual header for embedding, but store original text in DB
        const textToEmbed = this.buildEmbeddingText(
          chunk.text,
          note.title,
          chunk.sectionHeader,
          note.folderPath
        )
        const embedding = await this.embedDocument(textToEmbed)

        await vectorDB.upsertDocument({
          id: uuidv4(),
          noteId: note.id,
          chunkIndex: i,
          content: chunk.text,
          embedding,
          embeddingModel: this.embeddingModelId,
          sectionId: chunk.sectionId,
          sectionHeader: chunk.sectionHeader,
          metadata: {
            noteTitle: note.title,
            folderId: note.folderId,
            folderPath: note.folderPath,
            totalChunks: chunks.length,
            startOffset: chunk.startOffset,
            endOffset: chunk.endOffset
          }
        })
      }

      // Update indexing status with content hash
      vectorDB.updateIndexingStatus(note.id, contentHash, chunks.length)

      console.log(`[EmbeddingService] Indexed note ${note.id} with ${chunks.length} chunks`)
      return true
    } catch (error) {
      throw new EmbeddingFailedError(
        note.id,
        error instanceof Error ? error.message : 'Unknown error'
      )
    }
  }

  /**
   * Index multiple notes in batch with progress callback
   *
   * @param notes - Array of notes to index
   * @param vectorDB - The VectorDBManager instance
   * @param options - Optional chunking configuration
   * @param onProgress - Optional callback for progress updates
   * @returns Map of noteId to EmbeddingResult arrays
   */
  async indexNotesBatch(
    notes: IndexableNote[],
    vectorDB: VectorDBManager,
    _options: ExtendedChunkingOptions = DEFAULT_EXTENDED_OPTIONS,
    onProgress?: (completed: number, total: number) => void
  ): Promise<Map<string, EmbeddingResult[]>> {
    const results = new Map<string, EmbeddingResult[]>()
    const total = notes.length

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i]

      try {
        // Delete existing and prepare
        await vectorDB.deleteDocumentsForNote(note.id)

        const textContent = this.extractTextFromMarkdown(note.content)
        if (!textContent.trim()) {
          results.set(note.id, [])
          onProgress?.(i + 1, total)
          continue
        }

        const chunks = await this.structureAwareChunk(textContent, note.id)
        const noteResults: EmbeddingResult[] = []

        for (let j = 0; j < chunks.length; j++) {
          const chunk = chunks[j]
          // Use contextual header for embedding, but store original text in DB
          const textToEmbed = this.buildEmbeddingText(
            chunk.text,
            note.title,
            chunk.sectionHeader,
            note.folderPath
          )
          const embedding = await this.embedDocument(textToEmbed)

          await vectorDB.upsertDocument({
            id: uuidv4(),
            noteId: note.id,
            chunkIndex: j,
            content: chunk.text,
            embedding,
            embeddingModel: this.embeddingModelId,
            sectionId: chunk.sectionId,
            sectionHeader: chunk.sectionHeader,
            metadata: {
              noteTitle: note.title,
              folderId: note.folderId,
              folderPath: note.folderPath,
              totalChunks: chunks.length
            }
          })

          noteResults.push({
            noteId: note.id,
            chunkIndex: j,
            embedding,
            text: chunk.text
          })
        }

        results.set(note.id, noteResults)
      } catch (error) {
        console.error(`[EmbeddingService] Failed to index note ${note.id}:`, error)
        results.set(note.id, [])
      }

      onProgress?.(i + 1, total)
    }

    return results
  }

  /**
   * Generate embedding for a search query (uses 'search_query' prefix)
   * @param query - The search query text
   * @returns The embedding vector for similarity search
   */
  async embedQuery(query: string): Promise<number[]> {
    return this.embedWithPrefix('search_query', query)
  }

  /**
   * Extract text from Markdown content preserving semantic structure
   *
   * Removes non-semantic elements while keeping structural markers that
   * the chunking algorithm needs to identify sections and structure.
   *
   * **Removes:**
   * - Images `![alt](url)` → keeps only alt text
   * - Link URLs `[text](url)` → keeps only text
   * - HTML tags and entities
   * - Horizontal rules (`---`)
   * - Fenced code block markers (```) and language hints — keeps content
   * - Inline code backticks — keeps content
   * - Reference-style link syntax and definitions
   * - Strikethrough markers (`~~`) — keeps content
   *
   * **Preserves:**
   * - Header markers (`#`, `##`, `###`, …)
   * - List markers (`-`, `*`, `1.`)
   * - Emphasis (`**bold**`, `*italic*`)
   * - Blockquote markers (`>`)
   *
   * @param markdown - The Markdown (or Lexical-extracted) content
   * @returns Text with semantic markers preserved
   */
  extractTextFromMarkdown(markdown: string): string {
    if (!markdown) return ''

    let text = markdown

    // Remove fenced code block markers but keep the content inside
    // Matches ```lang\n...content...\n``` → keeps content
    text = text.replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')
    // Handle edge case: empty or single-line code blocks (``` on same line)
    text = text.replace(/```[^\n]*```/g, '')

    // Remove inline code backticks but keep the text
    text = text.replace(/`([^`]+)`/g, '$1')

    // Remove images ![alt](url) → keep alt text
    text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')

    // Remove link URLs [text](url) → keep text
    text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')

    // Remove reference-style links [text][id] → keep text
    text = text.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')

    // Remove link definitions [id]: url
    text = text.replace(/^\[[^\]]+\]:\s+.+$/gm, '')

    // Remove strikethrough markers but keep text
    text = text.replace(/~~(.+?)~~/g, '$1')

    // Remove HTML tags
    text = text.replace(/<[^>]+>/g, '')

    // Remove HTML entities
    text = text.replace(/&[a-zA-Z0-9#]+;/g, ' ')

    // Remove horizontal rules
    text = text.replace(/^[-*_]{3,}\s*$/gm, '')

    // Normalize whitespace
    text = text.replace(/\r\n/g, '\n')
    text = text.replace(/\n{3,}/g, '\n\n')
    text = text.replace(/[ \t]+/g, ' ')

    return text.trim()
  }

  /**
   * Chunk text with token-based limits and paragraph awareness
   *
   * Uses the embedding model's tokenizer to accurately measure chunk sizes
   * in tokens rather than characters, respecting the model's actual context limits.
   *
   * @param text - The text to chunk
   * @param options - Chunking configuration (token-based)
   * @returns Array of text chunks with position metadata
   */
  async chunkText(
    text: string,
    options: ExtendedChunkingOptions = DEFAULT_EXTENDED_OPTIONS
  ): Promise<TextChunk[]> {
    const { maxChunkTokens, overlapTokens, splitOnParagraph, minChunkTokens = 10 } = options
    const model = await this.aiManager.getModelInstance(this.embeddingModelId)
    const chunks: TextChunk[] = []

    if (splitOnParagraph) {
      // Split by paragraphs first (double newlines)
      const paragraphs = text.split(/\n\n+/)
      let currentChunk = ''
      let currentChunkTokens = 0
      let currentStartOffset = 0
      let runningOffset = 0

      for (const para of paragraphs) {
        const trimmedPara = para.trim()
        if (!trimmedPara) {
          runningOffset += para.length + 2 // Account for \n\n
          continue
        }

        const paraTokens = model.tokenize(trimmedPara).length
        // Separator \n\n is roughly 1 token
        const separatorTokens = currentChunk ? 1 : 0

        // Check if adding this paragraph exceeds max token limit
        if (currentChunkTokens + paraTokens + separatorTokens <= maxChunkTokens) {
          // Add to current chunk
          if (currentChunk) {
            currentChunk += '\n\n' + trimmedPara
          } else {
            currentChunk = trimmedPara
            currentStartOffset = runningOffset
          }
          currentChunkTokens += paraTokens + separatorTokens
        } else {
          // Save current chunk if it has content
          if (currentChunk && currentChunkTokens >= minChunkTokens) {
            chunks.push({
              text: currentChunk,
              index: chunks.length,
              startOffset: currentStartOffset,
              endOffset: currentStartOffset + currentChunk.length
            })
          }

          // Handle long paragraphs that exceed max token limit
          if (paraTokens > maxChunkTokens) {
            const subChunks = this.splitLongTextByTokens(
              trimmedPara,
              model,
              maxChunkTokens,
              overlapTokens,
              minChunkTokens
            )
            for (const subChunk of subChunks) {
              chunks.push({
                text: subChunk,
                index: chunks.length,
                startOffset: runningOffset,
                endOffset: runningOffset + subChunk.length
              })
            }
            currentChunk = ''
            currentChunkTokens = 0
          } else {
            currentChunk = trimmedPara
            currentChunkTokens = paraTokens
            currentStartOffset = runningOffset
          }
        }

        runningOffset += para.length + 2
      }

      // Don't forget the last chunk
      if (currentChunk && currentChunkTokens >= minChunkTokens) {
        chunks.push({
          text: currentChunk,
          index: chunks.length,
          startOffset: currentStartOffset,
          endOffset: currentStartOffset + currentChunk.length
        })
      }
    } else {
      // Token-based chunking without paragraph awareness
      const subChunks = this.splitLongTextByTokens(
        text,
        model,
        maxChunkTokens,
        overlapTokens,
        minChunkTokens
      )
      let offset = 0

      for (const subChunk of subChunks) {
        chunks.push({
          text: subChunk,
          index: chunks.length,
          startOffset: offset,
          endOffset: offset + subChunk.length
        })
        offset += subChunk.length
      }
    }

    return chunks
  }

  /**
   * Split long text into chunks using token-based boundaries
   *
   * Tokenizes the text, creates sliding windows of tokens,
   * and detokenizes each window back to text.
   *
   * @param text - The text to split
   * @param model - The LlamaModel instance for tokenization
   * @param maxTokens - Maximum tokens per chunk
   * @param overlapTokens - Token overlap between chunks
   * @param minTokens - Minimum tokens per chunk
   * @returns Array of text chunks
   */
  private splitLongTextByTokens(
    text: string,
    model: LlamaModel,
    maxTokens: number,
    overlapTokens: number,
    minTokens: number
  ): string[] {
    const tokens = model.tokenize(text)
    const chunks: string[] = []
    let start = 0

    while (start < tokens.length) {
      const end = Math.min(start + maxTokens, tokens.length)
      const chunkTokens = tokens.slice(start, end)
      const chunk = model.detokenize(chunkTokens).trim()

      if (chunk && (chunkTokens.length >= minTokens || end >= tokens.length)) {
        chunks.push(chunk)
      }

      // Move forward with overlap
      const nextStart = end - overlapTokens
      // Ensure we make progress
      start = nextStart <= start ? end : nextStart
    }

    return chunks
  }

  // ===========================================================================
  // Structure-Aware Chunking
  // ===========================================================================

  /**
   * Structure-aware chunking for Markdown notes
   *
   * Splits text by Markdown sections (H1/H2/H3), keeps small sections
   * whole, and splits large sections on block boundaries (paragraphs,
   * lists, blockquotes, tables). Never breaks in the middle of an
   * atomic block.
   *
   * Reference: docs/RAG_ARCHITECTURE.md §5.2
   *
   * @param text - Extracted text (with Markdown structural markers preserved)
   * @param noteId - Note ID for generating section IDs
   * @param options - Chunking configuration
   * @returns Array of structured chunks with section metadata
   */
  async structureAwareChunk(
    text: string,
    noteId: string,
    options: StructureAwareChunkingOptions = DEFAULT_STRUCTURE_AWARE_OPTIONS
  ): Promise<StructuredChunk[]> {
    const { maxChunkTokens, overlapTokens, minChunkTokens } = {
      ...DEFAULT_STRUCTURE_AWARE_OPTIONS,
      ...options
    }
    const minFilterTokens = 10
    const model = await this.aiManager.getModelInstance(this.embeddingModelId)

    // Step 1: Parse sections from Markdown headers
    const rawSections = this.parseSections(text)

    // Step 4 (early): Merge sections shorter than minChunkTokens with next section
    const sections = this.mergeShortSections(rawSections, model, minChunkTokens)

    const chunks: StructuredChunk[] = []

    // Step 2: Process each section
    for (const section of sections) {
      const sectionId = createHash('sha256')
        .update(noteId + section.header)
        .digest('hex')
        .slice(0, 16)

      const sectionTokens = model.tokenize(section.content).length

      if (sectionTokens <= maxChunkTokens) {
        // Section fits in one chunk — Step 3: filter tiny chunks
        if (sectionTokens >= minFilterTokens) {
          chunks.push({
            text: section.content,
            index: chunks.length,
            sectionId,
            sectionHeader: section.header,
            startOffset: section.startOffset,
            endOffset: section.endOffset
          })
        }
      } else {
        // Section too large — split respecting block boundaries
        const subChunks = this.splitSectionByBlocks(
          section,
          model,
          maxChunkTokens,
          overlapTokens,
          minFilterTokens
        )

        for (const sub of subChunks) {
          chunks.push({
            text: sub.text,
            index: chunks.length,
            sectionId,
            sectionHeader: section.header,
            startOffset: sub.startOffset,
            endOffset: sub.endOffset
          })
        }
      }
    }

    return chunks
  }

  /**
   * Parse Markdown text into sections by H1/H2/H3 headers.
   * Text before the first header becomes an "intro" section with empty header.
   */
  private parseSections(text: string): ParsedSection[] {
    const sections: ParsedSection[] = []
    const headerRegex = /^#{1,3} .+$/gm
    const headerPositions: Array<{ index: number; headerText: string }> = []

    let match: RegExpExecArray | null
    while ((match = headerRegex.exec(text)) !== null) {
      const headerText = match[0].replace(/^#{1,3}\s+/, '')
      headerPositions.push({ index: match.index, headerText })
    }

    if (headerPositions.length === 0) {
      // No headers — entire text is one intro section
      const trimmed = text.trim()
      if (trimmed) {
        return [{ header: '', content: trimmed, startOffset: 0, endOffset: text.length }]
      }
      return []
    }

    // Intro section (before first header)
    if (headerPositions[0].index > 0) {
      const introContent = text.slice(0, headerPositions[0].index).trim()
      if (introContent) {
        sections.push({
          header: '',
          content: introContent,
          startOffset: 0,
          endOffset: headerPositions[0].index
        })
      }
    }

    // Header sections
    for (let i = 0; i < headerPositions.length; i++) {
      const start = headerPositions[i].index
      const end = i < headerPositions.length - 1 ? headerPositions[i + 1].index : text.length
      const content = text.slice(start, end).trim()
      if (content) {
        sections.push({
          header: headerPositions[i].headerText,
          content,
          startOffset: start,
          endOffset: end
        })
      }
    }

    return sections
  }

  /**
   * Merge sections shorter than minChunkTokens with the following section.
   */
  private mergeShortSections(
    sections: ParsedSection[],
    model: LlamaModel,
    minChunkTokens: number
  ): ParsedSection[] {
    if (sections.length <= 1) return sections

    const input = [...sections]
    const result: ParsedSection[] = []

    for (let i = 0; i < input.length; i++) {
      const section = input[i]
      const tokenCount = model.tokenize(section.content).length

      if (tokenCount < minChunkTokens && i < input.length - 1) {
        // Merge with next section
        const next = input[i + 1]
        input[i + 1] = {
          header: next.header || section.header,
          content: section.content + '\n\n' + next.content,
          startOffset: section.startOffset,
          endOffset: next.endOffset
        }
      } else {
        result.push(section)
      }
    }

    return result
  }

  /**
   * Split a large section into chunks respecting atomic block boundaries.
   *
   * Atomic blocks (paragraphs, list groups, blockquotes, tables — separated
   * by double newlines) are never broken. If a single block exceeds
   * maxChunkTokens, it falls back to token-level splitting.
   * Consecutive sub-chunks share 32-token overlap for context continuity.
   */
  private splitSectionByBlocks(
    section: ParsedSection,
    model: LlamaModel,
    maxChunkTokens: number,
    overlapTokens: number,
    minFilterTokens: number
  ): Array<{ text: string; startOffset: number; endOffset: number }> {
    const blocks = this.parseAtomicBlocks(section.content)
    const result: Array<{ text: string; startOffset: number; endOffset: number }> = []

    let accumParts: string[] = []
    let accumTokens = 0
    let accumFirstBlockOffset = 0
    let accumLastBlockEnd = 0
    let previousChunkText = ''

    const flushChunk = (): void => {
      if (accumParts.length > 0 && accumTokens >= minFilterTokens) {
        const chunkText = accumParts.join('\n\n')
        result.push({
          text: chunkText,
          startOffset: section.startOffset + accumFirstBlockOffset,
          endOffset: section.startOffset + accumLastBlockEnd
        })
        previousChunkText = chunkText
      }
      accumParts = []
      accumTokens = 0
    }

    for (const block of blocks) {
      const blockTokens = model.tokenize(block.text).length
      const sepTokens = accumParts.length > 0 ? 1 : 0

      if (accumTokens + blockTokens + sepTokens <= maxChunkTokens) {
        // Fits in current chunk
        if (accumParts.length === 0) {
          accumFirstBlockOffset = block.offset
        }
        accumParts.push(block.text)
        accumTokens += blockTokens + sepTokens
        accumLastBlockEnd = block.offset + block.text.length
      } else {
        // Would exceed limit — flush and start new chunk
        flushChunk()

        if (blockTokens > maxChunkTokens) {
          // Single block too large — token-level fallback
          const subs = this.splitLongTextByTokens(
            block.text,
            model,
            maxChunkTokens,
            overlapTokens,
            minFilterTokens
          )
          for (const sub of subs) {
            result.push({
              text: sub,
              startOffset: section.startOffset + block.offset,
              endOffset: section.startOffset + block.offset + block.text.length
            })
          }
          previousChunkText = subs.length > 0 ? subs[subs.length - 1] : ''
        } else {
          // Add overlap from previous chunk if available
          if (previousChunkText && overlapTokens > 0) {
            const prevTokens = model.tokenize(previousChunkText)
            if (prevTokens.length > overlapTokens) {
              const overlapText = model.detokenize(prevTokens.slice(-overlapTokens)).trim()
              accumParts = [overlapText, block.text]
              accumTokens = overlapTokens + 1 + blockTokens
            } else {
              accumParts = [block.text]
              accumTokens = blockTokens
            }
          } else {
            accumParts = [block.text]
            accumTokens = blockTokens
          }
          accumFirstBlockOffset = block.offset
          accumLastBlockEnd = block.offset + block.text.length
        }
      }
    }

    // Flush remaining
    flushChunk()

    return result
  }

  /**
   * Parse text into atomic blocks separated by double newlines.
   * Each block (paragraph, list group, blockquote, table) is an indivisible unit.
   */
  private parseAtomicBlocks(text: string): Array<{ text: string; offset: number }> {
    const blocks: Array<{ text: string; offset: number }> = []
    const separator = /\n{2,}/g
    let lastEnd = 0
    let match: RegExpExecArray | null

    while ((match = separator.exec(text)) !== null) {
      const blockText = text.slice(lastEnd, match.index).trim()
      if (blockText) {
        blocks.push({ text: blockText, offset: lastEnd })
      }
      lastEnd = match.index + match[0].length
    }

    // Last block
    const lastBlock = text.slice(lastEnd).trim()
    if (lastBlock) {
      blocks.push({ text: lastBlock, offset: lastEnd })
    }

    return blocks
  }
}
