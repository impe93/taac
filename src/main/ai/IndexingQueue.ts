/**
 * Indexing Queue
 *
 * Background indexing queue with per-note debounce for auto-indexing notes
 * after save. Processes jobs sequentially, yields to the event loop between
 * jobs, and emits progress events for UI updates.
 *
 * Reference: docs/RAG_ARCHITECTURE.md §11.3 Indexing Queue
 */

import { EventEmitter } from 'events'
import type { EmbeddingService, IndexableNote } from './EmbeddingService'
import type { VectorDBManager } from './VectorDBManager'

// ============================================================================
// TYPES
// ============================================================================

/**
 * A pending indexing job in the queue
 */
export interface IndexingJob {
  noteId: string
  spaceId: string
  folderId: string
  folderPath?: string // Full hierarchical folder path for semantic search (e.g. "Projects / Client A / Meetings")
  content: string // Already extracted text (from Lexical → Markdown)
  noteTitle: string
}

/**
 * Progress event emitted by the IndexingQueue
 */
export interface IndexingProgressEvent {
  spaceId: string
  noteId: string
  noteTitle: string
  status: 'queued' | 'indexing' | 'completed' | 'skipped' | 'error'
  queueSize: number
  error?: string
}

/**
 * Options for IndexingQueue construction
 */
export interface IndexingQueueOptions {
  /** Debounce delay in ms before a note is actually queued (default 3000) */
  debounceMs?: number
}

// ============================================================================
// INDEXING QUEUE
// ============================================================================

type GetVectorDB = (spaceId: string) => VectorDBManager

/**
 * Background indexing queue with per-note debounce.
 *
 * - Deduplicates by noteId: if a note is saved 5 times, only the latest
 *   content is indexed.
 * - Debounces per note: waits 3s after the last save before queueing.
 * - Processes jobs sequentially, one at a time.
 * - Yields to the event loop between jobs via setImmediate.
 * - Content-hash check: skips notes whose content hasn't changed.
 * - Emits 'progress' events for UI updates.
 */
export class IndexingQueue extends EventEmitter {
  private queue: Map<string, IndexingJob> = new Map()
  private isProcessing = false
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map()
  private debounceMs: number
  private disposed = false
  private embeddingAvailable = false

  private embeddingService: EmbeddingService
  private getVectorDB: GetVectorDB

  constructor(
    embeddingService: EmbeddingService,
    getVectorDB: GetVectorDB,
    options?: IndexingQueueOptions
  ) {
    super()
    this.embeddingService = embeddingService
    this.getVectorDB = getVectorDB
    this.debounceMs = options?.debounceMs ?? 3000
  }

  /**
   * Set whether the embedding model is available.
   * When unavailable, enqueue() is a noop.
   * When becoming available, pending debounced jobs will still fire.
   */
  setEmbeddingAvailable(available: boolean): void {
    this.embeddingAvailable = available
  }

  /**
   * Check if the embedding model is currently available
   */
  isEmbeddingAvailable(): boolean {
    return this.embeddingAvailable
  }

  /**
   * Enqueue a note for background indexing with debounce.
   *
   * If the embedding model is not available, this is a noop.
   * If the note is already queued or debouncing, the timer is reset
   * and the content is updated to the latest version.
   *
   * @param noteId - The note ID
   * @param spaceId - The space ID
   * @param folderId - The folder ID containing the note
   * @param content - The extracted text content (Markdown with structure preserved)
   * @param noteTitle - The note title
   */
  enqueue(
    noteId: string,
    spaceId: string,
    folderId: string,
    content: string,
    noteTitle: string,
    folderPath?: string
  ): void {
    if (this.disposed || !this.embeddingAvailable) return
    if (!content.trim()) return

    // Cancel existing debounce timer for this note
    const existingTimer = this.debounceTimers.get(noteId)
    if (existingTimer) clearTimeout(existingTimer)

    // Set new debounce timer (3s after last save)
    this.debounceTimers.set(
      noteId,
      setTimeout(() => {
        this.debounceTimers.delete(noteId)
        this.queue.set(noteId, { noteId, spaceId, folderId, folderPath, content, noteTitle })
        this.emitProgress({
          spaceId,
          noteId,
          noteTitle,
          status: 'queued',
          queueSize: this.queue.size
        })
        this.processNext()
      }, this.debounceMs)
    )
  }

  /**
   * Process the next job in the queue.
   *
   * - Takes the first job (FIFO via Map insertion order).
   * - Checks content-hash for staleness.
   * - Calls EmbeddingService.indexNote() for the actual indexing.
   * - Yields to event loop via setImmediate before processing the next job.
   */
  private async processNext(): Promise<void> {
    if (this.isProcessing || this.queue.size === 0 || this.disposed) return
    this.isProcessing = true

    const entry = this.queue.entries().next().value
    if (!entry) {
      this.isProcessing = false
      return
    }

    const [noteId, job] = entry
    this.queue.delete(noteId)

    try {
      this.emitProgress({
        spaceId: job.spaceId,
        noteId: job.noteId,
        noteTitle: job.noteTitle,
        status: 'indexing',
        queueSize: this.queue.size
      })

      const vectorDB = this.getVectorDB(job.spaceId)

      // Build IndexableNote for EmbeddingService
      const indexableNote: IndexableNote = {
        id: job.noteId,
        folderId: job.folderId,
        folderPath: job.folderPath,
        content: job.content,
        title: job.noteTitle,
        createdAt: '',
        updatedAt: ''
      }

      // indexNote handles content-hash check internally and returns false if skipped
      const wasIndexed = await this.embeddingService.indexNote(indexableNote, vectorDB)

      this.emitProgress({
        spaceId: job.spaceId,
        noteId: job.noteId,
        noteTitle: job.noteTitle,
        status: wasIndexed ? 'completed' : 'skipped',
        queueSize: this.queue.size
      })
    } catch (error) {
      console.error(`[IndexingQueue] Failed to index note ${noteId}:`, error)
      this.emitProgress({
        spaceId: job.spaceId,
        noteId: job.noteId,
        noteTitle: job.noteTitle,
        status: 'error',
        queueSize: this.queue.size,
        error: (error as Error).message
      })
    } finally {
      this.isProcessing = false
      // Yield to event loop before processing next job
      if (!this.disposed && this.queue.size > 0) {
        setImmediate(() => this.processNext())
      }
    }
  }

  /**
   * Emit a typed progress event
   */
  private emitProgress(event: IndexingProgressEvent): void {
    this.emit('progress', event)
  }

  /**
   * Number of jobs waiting in the queue (not counting debouncing notes)
   */
  get pendingCount(): number {
    return this.queue.size
  }

  /**
   * Number of notes currently debouncing (waiting for 3s inactivity)
   */
  get debouncingCount(): number {
    return this.debounceTimers.size
  }

  /**
   * Whether the queue is currently processing a job
   */
  get processing(): boolean {
    return this.isProcessing
  }

  /**
   * Dispose the queue: cancel all timers, clear the queue, remove listeners.
   * After disposal, enqueue() becomes a noop.
   */
  dispose(): void {
    this.disposed = true
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer)
    }
    this.debounceTimers.clear()
    this.queue.clear()
    this.removeAllListeners()
  }
}
