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
import type { EmbeddingResult, ChunkingOptions } from './types'
import { DEFAULT_CHUNKING_OPTIONS } from './types'
import { EmbeddingFailedError, AINotInitializedError } from './errors'
import { v4 as uuidv4 } from 'uuid'

/**
 * Extended chunking options with paragraph splitting
 */
export interface ExtendedChunkingOptions extends ChunkingOptions {
  /** Minimum chunk size to keep (avoids tiny fragments) */
  minChunkSize?: number
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
 * Default extended chunking options
 */
const DEFAULT_EXTENDED_OPTIONS: ExtendedChunkingOptions = {
  ...DEFAULT_CHUNKING_OPTIONS,
  minChunkSize: 50
}

/**
 * Embedding Service
 *
 * Manages embedding generation and note indexing using AIManager
 * and VectorDBManager for RAG functionality.
 */
export class EmbeddingService {
  private aiManager: AIManager
  private embeddingModelId: string = 'nomic-embed-text-v1.5'

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
   * Generate embedding for a single text
   * @param text - The text to embed
   * @returns The embedding vector
   */
  async embedText(text: string): Promise<number[]> {
    if (!this.aiManager.isInitialized()) {
      throw new AINotInitializedError()
    }

    const context = await this.aiManager.getEmbeddingContext(this.embeddingModelId)
    const embedding = await context.getEmbeddingFor(text)
    // Convert readonly number[] to mutable number[]
    return [...embedding.vector]
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
      // Convert readonly number[] to mutable number[]
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

      // Chunk the content with paragraph awareness
      const chunks = this.chunkText(textContent, options)

      if (chunks.length === 0) {
        console.log(`[EmbeddingService] Note ${note.id} produced no valid chunks, skipping`)
        return
      }

      // Generate embeddings and store each chunk
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]
        const embedding = await this.embedText(chunk.text)

        await vectorDB.upsertDocument({
          id: uuidv4(),
          noteId: note.id,
          chunkIndex: i,
          content: chunk.text,
          embedding,
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

        const chunks = this.chunkText(textContent, options)
        const noteResults: EmbeddingResult[] = []

        for (let j = 0; j < chunks.length; j++) {
          const chunk = chunks[j]
          const embedding = await this.embedText(chunk.text)

          await vectorDB.upsertDocument({
            id: uuidv4(),
            noteId: note.id,
            chunkIndex: j,
            content: chunk.text,
            embedding,
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
   * Generate embedding for a search query
   * @param query - The search query text
   * @returns The embedding vector for similarity search
   */
  async embedQuery(query: string): Promise<number[]> {
    return this.embedText(query)
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
   * Chunk text with overlap and paragraph awareness
   *
   * @param text - The text to chunk
   * @param options - Chunking configuration
   * @returns Array of text chunks with position metadata
   */
  chunkText(
    text: string,
    options: ExtendedChunkingOptions = DEFAULT_EXTENDED_OPTIONS
  ): TextChunk[] {
    const { maxChunkSize, overlapSize, splitOnParagraph, minChunkSize = 50 } = options
    const chunks: TextChunk[] = []

    if (splitOnParagraph) {
      // Split by paragraphs first (double newlines)
      const paragraphs = text.split(/\n\n+/)
      let currentChunk = ''
      let currentStartOffset = 0
      let runningOffset = 0

      for (const para of paragraphs) {
        const trimmedPara = para.trim()
        if (!trimmedPara) {
          runningOffset += para.length + 2 // Account for \n\n
          continue
        }

        // Check if adding this paragraph exceeds max size
        if (currentChunk.length + trimmedPara.length + 2 <= maxChunkSize) {
          // Add to current chunk
          if (currentChunk) {
            currentChunk += '\n\n' + trimmedPara
          } else {
            currentChunk = trimmedPara
            currentStartOffset = runningOffset
          }
        } else {
          // Save current chunk if it has content
          if (currentChunk && currentChunk.length >= minChunkSize) {
            chunks.push({
              text: currentChunk,
              index: chunks.length,
              startOffset: currentStartOffset,
              endOffset: currentStartOffset + currentChunk.length
            })
          }

          // Handle long paragraphs that exceed max size
          if (trimmedPara.length > maxChunkSize) {
            const subChunks = this.splitLongText(
              trimmedPara,
              maxChunkSize,
              overlapSize,
              minChunkSize
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
          } else {
            currentChunk = trimmedPara
            currentStartOffset = runningOffset
          }
        }

        runningOffset += para.length + 2
      }

      // Don't forget the last chunk
      if (currentChunk && currentChunk.length >= minChunkSize) {
        chunks.push({
          text: currentChunk,
          index: chunks.length,
          startOffset: currentStartOffset,
          endOffset: currentStartOffset + currentChunk.length
        })
      }
    } else {
      // Simple character-based chunking without paragraph awareness
      const subChunks = this.splitLongText(text, maxChunkSize, overlapSize, minChunkSize)
      let offset = 0

      for (const subChunk of subChunks) {
        chunks.push({
          text: subChunk,
          index: chunks.length,
          startOffset: offset,
          endOffset: offset + subChunk.length
        })
        offset += maxChunkSize - overlapSize
      }
    }

    return chunks
  }

  /**
   * Split long text into chunks with overlap
   *
   * @param text - The text to split
   * @param maxSize - Maximum chunk size
   * @param overlap - Overlap between chunks
   * @param minSize - Minimum chunk size
   * @returns Array of text chunks
   */
  private splitLongText(text: string, maxSize: number, overlap: number, minSize: number): string[] {
    const chunks: string[] = []
    let start = 0

    while (start < text.length) {
      let end = Math.min(start + maxSize, text.length)

      // Try to break at word boundary if not at the end
      if (end < text.length) {
        const lastSpace = text.lastIndexOf(' ', end)
        if (lastSpace > start + minSize) {
          end = lastSpace
        }
      }

      const chunk = text.slice(start, end).trim()

      if (chunk.length >= minSize || start + maxSize >= text.length) {
        chunks.push(chunk)
      }

      // Move forward with overlap
      start = end - overlap

      // Ensure we make progress
      if (start <= chunks.length * (maxSize - overlap) - maxSize) {
        start = end
      }
    }

    return chunks
  }
}
