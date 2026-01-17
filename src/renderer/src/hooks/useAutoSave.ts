import { useCallback, useRef, useEffect } from 'react'

interface UseAutoSaveOptions {
  onSave: () => void | Promise<void>
  delay?: number
  enabled?: boolean
}

interface UseAutoSaveReturn {
  triggerSave: () => void
  saveNow: () => Promise<void>
  hasPendingSave: () => boolean
}

export function useAutoSave({
  onSave,
  delay = 1500,
  enabled = true
}: UseAutoSaveOptions): UseAutoSaveReturn {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isMountedRef = useRef(true)
  const pendingSaveRef = useRef(false)
  const onSaveRef = useRef(onSave)

  // Keep onSave ref updated to avoid stale closures
  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true
    return (): void => {
      isMountedRef.current = false
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  const triggerSave = useCallback((): void => {
    if (!enabled) return

    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    pendingSaveRef.current = true

    // Set new timeout
    timeoutRef.current = setTimeout(async () => {
      if (isMountedRef.current && pendingSaveRef.current) {
        pendingSaveRef.current = false
        try {
          await onSaveRef.current()
        } catch (error) {
          console.error('Auto-save failed:', error)
        }
      }
    }, delay)
  }, [delay, enabled])

  // Force immediate save (useful before unmount or navigation)
  const saveNow = useCallback(async (): Promise<void> => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    if (pendingSaveRef.current) {
      pendingSaveRef.current = false
      try {
        await onSaveRef.current()
      } catch (error) {
        console.error('Immediate save failed:', error)
      }
    }
  }, [])

  const hasPendingSave = useCallback((): boolean => {
    return pendingSaveRef.current
  }, [])

  return { triggerSave, saveNow, hasPendingSave }
}
