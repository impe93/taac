import { useState, useEffect, useCallback } from 'react'
import type { ProcessingProgress } from '@preload/index.d'

interface UseMeetingProcessingReturn {
  isProcessing: boolean
  progress: ProcessingProgress | null
  startProcessing: (spaceId: string) => Promise<void>
  error: string | null
}

export function useMeetingProcessing(noteId: string): UseMeetingProcessingReturn {
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState<ProcessingProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const unsubscribe = window.audio.onProcessingProgress((data: ProcessingProgress) => {
      if (data.noteId === noteId) {
        setProgress(data)
      }
    })

    return unsubscribe
  }, [noteId])

  const startProcessing = useCallback(
    async (spaceId: string): Promise<void> => {
      setError(null)
      setProgress(null)
      setIsProcessing(true)

      try {
        await window.audio.processRecording(noteId, spaceId)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Processing failed'
        setError(message)
      } finally {
        setIsProcessing(false)
      }
    },
    [noteId]
  )

  return { isProcessing, progress, startProcessing, error }
}
