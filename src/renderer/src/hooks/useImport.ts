import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type {
  ImportSource,
  ImportOptions,
  ImportScanResult,
  ImportResult,
  ImportProgressEvent
} from '@preload/types'

/**
 * Mutation for selecting an import folder via native dialog
 */
export const useSelectImportFolder = () => {
  return useMutation<string | null>({
    mutationFn: () => window.import.selectFolder()
  })
}

/**
 * Mutation for checking Apple Notes Full Disk Access permission
 */
export const useCheckAppleNotesAccess = () => {
  return useMutation<{ accessible: boolean; dbPath?: string; error?: string }>({
    mutationFn: () => window.import.checkAppleNotesAccess()
  })
}

/**
 * Mutation for scanning an import source to preview what will be imported
 */
export const useScanImport = () => {
  return useMutation<ImportScanResult, Error, { sourcePath: string; source: ImportSource }>({
    mutationFn: ({ sourcePath, source }) => window.import.scan(sourcePath, source)
  })
}

/**
 * Hook for starting an import with real-time progress tracking
 *
 * Features:
 * - Real-time progress updates via IPC events
 * - Automatic spaces query invalidation on success
 * - Progress auto-clears 2s after completion or error
 */
export const useStartImport = () => {
  const queryClient = useQueryClient()
  const [progress, setProgress] = useState<ImportProgressEvent | null>(null)

  useEffect(() => {
    const unsubscribe = window.import.onProgress((event: ImportProgressEvent) => {
      setProgress(event)

      if (event.status === 'complete' || event.status === 'error') {
        setTimeout(() => setProgress(null), 2000)
      }
    })

    return unsubscribe
  }, [])

  const mutation = useMutation<ImportResult, Error, ImportOptions>({
    mutationFn: (options) => window.import.start(options),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['spaces'] })
    }
  })

  return { ...mutation, progress }
}
