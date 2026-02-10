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
import type { LlamaModel } from 'node-llama-cpp'
import type { EmbeddingResult, ChunkingOptions } from './types'
import { DEFAULT_CHUNKING_OPTIONS } from './types'
import { EmbeddingFailedError, AINotInitializedError } from './errors'
import { v4 as uuidv4 } from 'uuid'

/**
 * Extended chunking options with token-based limits
 */
export interface ExtendedChunkingOptions extends ChunkingOptions {
  /** Minimum chunk size in tokens to keep (avoids tiny fragments) */
  minChunkTokens?: number
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

  /**
   * Create an EmbeddingService instance
   * @param aiManager - The AIManager instance for embedding generation
   */
  constructor(aiManager: AIManager) {
    this.aiManager = aiManager
  }

  /**
   * Set the embedding model to use
   * @param modelId - The model ID from ModelRegistry
   */
  setEmbeddingModel(modelId: string): void {
    this.embeddingModelId = modelId
  }

  /**
   * Get the current embedding model ID
   */
  getEmbeddingModel(): string {
    return this.embeddingModelId
  }

  /**
   * Generate embedding for a single text (no task prefix)
   * @param text - The text to embed
   * @returns The embedding vector as returned by the model
   */
  async embedText(text: string): Promise<number[]> {
    if (!this.aiManager.isInitialized()) {
      throw new AINotInitializedError()
    }

    const context = await this.aiManager.getEmbeddingContext(this.embeddingModelId)
    const embedding = await context.getEmbeddingFor(text)
    return [...embedding.vector]
  }

  /**
   * Generate embedding with a task-specific prefix
   * nomic-embed-text-v2-moe requires 'search_document' / 'search_query' prefixes
   * for proper asymmetric search quality
   */
  private async embedWithPrefix(prefix: string, text: string): Promise<number[]> {
    if (!this.aiManager.isInitialized()) {
      throw new AINotInitializedError()
    }

    const context = await this.aiManager.getEmbeddingContext(this.embeddingModelId)
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
    if (!this.aiManager.isInitialized()) {
      throw new AINotInitializedError()
    }

    const context = await this.aiManager.getEmbeddingContext(this.embeddingModelId)
    const embeddings: number[][] = []

    for (const text of texts) {
      const embedding = await context.getEmbeddingFor(text)
      embeddings.push([...embedding.vector])
    }

    return embeddings
  }

  /**
   * Index a note into the vector database
   *
   * This method:
   * 1. Deletes existing embeddings for the note
   * 2. Extracts text from Markdown content
   * 3. Chunks the text with overlap
   * 4. Generates embeddings for each chunk
   * 5. Stores in VectorDB
   *
   * @param note - The note to index
   * @param vectorDB - The VectorDBManager instance
   * @param options - Optional chunking configuration
   */
  async indexNote(
    note: IndexableNote,
    vectorDB: VectorDBManager,
    options: ExtendedChunkingOptions = DEFAULT_EXTENDED_OPTIONS
  ): Promise<void> {
    try {
      // Delete existing chunks for this note
      await vectorDB.deleteDocumentsForNote(note.id)

      // Extract text from Markdown content
      const textContent = this.extractTextFromMarkdown(note.content)

      if (!textContent.trim()) {
        console.log(`[EmbeddingService] Note ${note.id} has no text content, skipping indexing`)
        return
      }

      // Chunk the content with token-aware paragraph splitting
      const chunks = await this.chunkText(textContent, options)

      if (chunks.length === 0) {
        console.log(`[EmbeddingService] Note ${note.id} produced no valid chunks, skipping`)
        return
      }

      // Generate embeddings and store each chunk
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]
        const embedding = await this.embedDocument(chunk.text)

        await vectorDB.upsertDocument({
          id: uuidv4(),
          noteId: note.id,
          chunkIndex: i,
          content: chunk.text,
          embedding,
          embeddingModel: this.embeddingModelId,
          metadata: {
            noteTitle: note.title,
            folderId: note.folderId,
            totalChunks: chunks.length,
            startOffset: chunk.startOffset,
            endOffset: chunk.endOffset
          }
        })
      }

      console.log(`[EmbeddingService] Indexed note ${note.id} with ${chunks.length} chunks`)
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
    options: ExtendedChunkingOptions = DEFAULT_EXTENDED_OPTIONS,
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

        const chunks = await this.chunkText(textContent, options)
        const noteResults: EmbeddingResult[] = []

        for (let j = 0; j < chunks.length; j++) {
          const chunk = chunks[j]
          const embedding = await this.embedDocument(chunk.text)

          await vectorDB.upsertDocument({
            id: uuidv4(),
            noteId: note.id,
            chunkIndex: j,
            content: chunk.text,
            embedding,
            embeddingModel: this.embeddingModelId,
            metadata: {
              noteTitle: note.title,
              folderId: note.folderId,
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
   * Extract plain text from Markdown content
   *
   * Strips Markdown syntax to get clean text for embedding:
   * - Headers (# ## ###)
   * - Bold/italic (**text** *text*)
   * - Links [text](url)
   * - Images ![alt](url)
   * - Code blocks ```code```
   * - Inline code `code`
   * - Lists (- * 1.)
   * - Blockquotes (>)
   * - Horizontal rules (---)
   * - HTML tags
   *
   * @param markdown - The Markdown content
   * @returns Plain text content
   */
  extractTextFromMarkdown(markdown: string): string {
    if (!markdown) return ''

    let text = markdown

    // Remove code blocks (fenced with ```)
    text = text.replace(/```[\s\S]*?```/g, '')

    // Remove inline code
    text = text.replace(/`[^`]+`/g, '')

    // Remove images ![alt](url)
    text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')

    // Convert links [text](url) to just text
    text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')

    // Remove reference-style links
    text = text.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')

    // Remove link definitions [id]: url
    text = text.replace(/^\[[^\]]+\]:\s+.+$/gm, '')

    // Remove headers (keep the text)
    text = text.replace(/^#{1,6}\s+(.+)$/gm, '$1')

    // Remove bold/italic markers
    text = text.replace(/\*\*\*(.+?)\*\*\*/g, '$1')
    text = text.replace(/\*\*(.+?)\*\*/g, '$1')
    text = text.replace(/\*(.+?)\*/g, '$1')
    text = text.replace(/___(.+?)___/g, '$1')
    text = text.replace(/__(.+?)__/g, '$1')
    text = text.replace(/_(.+?)_/g, '$1')

    // Remove strikethrough
    text = text.replace(/~~(.+?)~~/g, '$1')

    // Remove blockquotes (>)
    text = text.replace(/^>\s*/gm, '')

    // Remove horizontal rules
    text = text.replace(/^[-*_]{3,}\s*$/gm, '')

    // Remove list markers (-, *, 1.)
    text = text.replace(/^\s*[-*+]\s+/gm, '')
    text = text.replace(/^\s*\d+\.\s+/gm, '')

    // Remove HTML tags
    text = text.replace(/<[^>]+>/g, '')

    // Remove HTML entities
    text = text.replace(/&[a-zA-Z0-9#]+;/g, ' ')

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
}
