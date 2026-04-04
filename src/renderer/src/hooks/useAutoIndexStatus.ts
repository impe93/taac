import { useState, useEffect, useCallback } from 'react'

interface AutoIndexProgressEvent {
  spaceId: string
  noteId: string
  noteTitle: string
  status: 'queued' | 'indexing' | 'completed' | 'skipped' | 'error'
  queueSize: number
  error?: string
}

interface AutoIndexStatus {
  /** Whether a note is currently being indexed */
  isIndexing: boolean
  /** Title of the note currently being indexed */
  currentNoteTitle: string | null
  /** Number of notes waiting in the queue */
  queueSize: number
  /** Whether the embedding model needs to be downloaded */
  embeddingModelNeeded: boolean
  /** Model ID that needs downloading (when embeddingModelNeeded is true) */
  neededModelId: string | null
  /** Dismiss the embedding model needed banner */
  dismissModelNeeded: () => void
}

/**
 * Hook that provides real-time auto-indexing status from the main process IndexingQueue.
 *
 * Listens to:
 * - `ai:auto-index-progress` for per-note background indexing progress
 * - `ai:embedding-model-needed` for embedding model download prompts
 */
export const useAutoIndexStatus = (): AutoIndexStatus => {
  const [isIndexing, setIsIndexing] = useState(false)
  const [currentNoteTitle, setCurrentNoteTitle] = useState<string | null>(null)
  const [queueSize, setQueueSize] = useState(0)
  const [embeddingModelNeeded, setEmbeddingModelNeeded] = useState(false)
  const [neededModelId, setNeededModelId] = useState<string | null>(null)

  const dismissModelNeeded = useCallback((): void => {
    setEmbeddingModelNeeded(false)
    setNeededModelId(null)
  }, [])

  useEffect(() => {
    // Listen for auto-index progress events from IndexingQueue
    const cleanupProgress = window.ai.onAutoIndexProgress((event: AutoIndexProgressEvent) => {
      setQueueSize(event.queueSize)

      switch (event.status) {
        case 'indexing':
          setIsIndexing(true)
          setCurrentNoteTitle(event.noteTitle)
          break
        case 'completed':
        case 'skipped':
        case 'error':
          // If queue is empty, indexing is done
          if (event.queueSize === 0) {
            setIsIndexing(false)
            setCurrentNoteTitle(null)
          }
          break
        case 'queued':
          // A note was queued but not yet processing
          break
      }
    })

    // Listen for embedding model needed events
    const cleanupModelNeeded = window.ai.onEmbeddingModelNeeded((data) => {
      setEmbeddingModelNeeded(true)
      setNeededModelId(data.modelId)
    })

    return (): void => {
      cleanupProgress()
      cleanupModelNeeded()
    }
  }, [])

  return {
    isIndexing,
    currentNoteTitle,
    queueSize,
    embeddingModelNeeded,
    neededModelId,
    dismissModelNeeded
  }
}
