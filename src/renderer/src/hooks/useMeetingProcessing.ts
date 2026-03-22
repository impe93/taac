import { useState, useEffect, useCallback } from 'react'
import type { ProcessingProgress } from '@preload/index.d'
import type { MeetingMetadata } from '@preload/types'

export interface ProcessingResult {
  metadata: MeetingMetadata
  content: string
}

interface UseMeetingProcessingReturn {
  isProcessing: boolean
  progress: ProcessingProgress | null
  startProcessing: (spaceId: string) => Promise<ProcessingResult | null>
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
    async (spaceId: string): Promise<ProcessingResult | null> => {
      setError(null)
      setProgress(null)
      setIsProcessing(true)

      try {
        const result = await window.audio.processRecording(noteId, spaceId)
        return result as ProcessingResult
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Processing failed'
        setError(message)
        return null
      } finally {
        setIsProcessing(false)
      }
    },
    [noteId]
  )

  return { isProcessing, progress, startProcessing, error }
}
