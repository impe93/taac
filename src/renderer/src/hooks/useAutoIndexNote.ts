import { useRef, useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

interface UseAutoIndexNoteOptions {
  /** Debounce delay in ms before indexing (default: 5000ms) */
  delay?: number
  /** Whether auto-indexing is enabled */
  enabled?: boolean
}

interface UseAutoIndexNoteReturn {
  /** Trigger auto-indexing (debounced) */
  triggerIndex: (params: { spaceId: string; noteId: string; folderId: string }) => void
  /** Force immediate indexing */
  indexNow: () => void
  /** Whether indexing is currently in progress */
  isIndexing: boolean
}

/**
 * Hook for auto-indexing notes after save with debouncing.
 *
 * Features:
 * - Debounced indexing (default 5s) to avoid frequent re-indexing during active editing
 * - Checks AI initialization and config before indexing
 * - Runs in background without blocking UI
 * - Invalidates indexed notes query on completion
 */
export const useAutoIndexNote = (options: UseAutoIndexNoteOptions = {}): UseAutoIndexNoteReturn => {
  const { delay = 5000, enabled = true } = options

  const queryClient = useQueryClient()
  const [isIndexing, setIsIndexing] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingParamsRef = useRef<{
    spaceId: string
    noteId: string
    folderId: string
  } | null>(null)
  const isEnabledRef = useRef(enabled)

  // Keep enabled ref in sync
  useEffect(() => {
    isEnabledRef.current = enabled
  }, [enabled])

  // Perform the actual indexing
  const performIndex = useCallback(async (): Promise<void> => {
    const params = pendingParamsRef.current
    if (!params) return

    // Check if auto-indexing is enabled in config
    try {
      const autoIndexEnabled = await window.config.get('autoIndexNotes')
      if (autoIndexEnabled === false) {
        return
      }
    } catch {
      // If config read fails, proceed with indexing
    }

    // Check if AI is initialized
    try {
      const isAiInitialized = await window.ai.isInitialized()
      if (!isAiInitialized) {
        return
      }
    } catch {
      // AI not available, skip indexing
      return
    }

    // Perform indexing in background
    setIsIndexing(true)
    try {
      await window.ai.indexNote(params.spaceId, params.noteId, params.folderId)
      // Invalidate indexed notes query to refresh the list
      queryClient.invalidateQueries({
        queryKey: ['ai', 'indexed', params.spaceId]
      })
    } catch (error) {
      // Log error but don't show to user - indexing failure shouldn't interrupt workflow
      console.warn('Auto-indexing failed:', error)
    } finally {
      setIsIndexing(false)
      pendingParamsRef.current = null
    }
  }, [queryClient])

  // Trigger indexing with debounce
  const triggerIndex = useCallback(
    (params: { spaceId: string; noteId: string; folderId: string }): void => {
      if (!isEnabledRef.current) return

      // Store params for later
      pendingParamsRef.current = params

      // Clear existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }

      // Set new timeout
      timeoutRef.current = setTimeout(() => {
        performIndex()
        timeoutRef.current = null
      }, delay)
    },
    [delay, performIndex]
  )

  // Force immediate indexing
  const indexNow = useCallback((): void => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }

    if (pendingParamsRef.current) {
      performIndex()
    }
  }, [performIndex])

  // Cleanup on unmount
  useEffect(() => {
    return (): void => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  return {
    triggerIndex,
    indexNow,
    isIndexing
  }
}
