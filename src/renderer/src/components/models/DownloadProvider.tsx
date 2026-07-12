import { useEffect, useMemo, useState, type FC, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { DownloadProgress } from '@main/ai/types'
import { DownloadContext, type DownloadContextValue } from './downloadContext'

/**
 * App-wide model-download state. The actual transfer runs in the main process
 * (`ModelDownloader`) and broadcasts progress to every window, so downloads
 * continue even when the view that started them unmounts. This provider keeps a
 * single renderer-side mirror of that progress: it seeds from the main process
 * on mount (so a remount doesn't lose in-flight downloads) and then tracks live
 * events. Mount it once, high in the tree.
 */
export const DownloadProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const queryClient = useQueryClient()
  const [progress, setProgress] = useState<Map<string, DownloadProgress>>(new Map())

  // Seed from the main process so background downloads stay visible after a
  // remount (e.g. reopening Settings while a download is running).
  useEffect(() => {
    let cancelled = false
    window.ai
      .getActiveDownloads()
      .then((active) => {
        if (cancelled || active.length === 0) return
        setProgress((prev) => {
          const next = new Map(prev)
          for (const p of active) if (!next.has(p.modelId)) next.set(p.modelId, p)
          return next
        })
      })
      .catch(() => {
        /* best-effort seeding */
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Track live progress events for the lifetime of the app.
  useEffect(() => {
    const unsubscribe = window.ai.onDownloadProgress((p: DownloadProgress) => {
      setProgress((prev) => {
        const next = new Map(prev)
        next.set(p.modelId, p)
        return next
      })

      if (p.status === 'completed') {
        queryClient.invalidateQueries({ queryKey: ['ai', 'models', 'downloaded'] })
      }
    })

    return unsubscribe
  }, [queryClient])

  const downloadMutation = useMutation({
    mutationFn: (modelId: string) => window.ai.downloadModel(modelId)
  })

  const pauseMutation = useMutation({
    mutationFn: (modelId: string) => window.ai.pauseDownload(modelId)
  })

  const resumeMutation = useMutation({
    mutationFn: (modelId: string) => window.ai.resumeDownload(modelId)
  })

  const cancelMutation = useMutation({
    mutationFn: (modelId: string) => window.ai.cancelDownload(modelId),
    onSuccess: (_data, modelId) => {
      setProgress((prev) => {
        const next = new Map(prev)
        next.delete(modelId)
        return next
      })
    }
  })

  const value = useMemo<DownloadContextValue>(
    () => ({
      progress,
      download: downloadMutation.mutate,
      downloadAsync: downloadMutation.mutateAsync,
      pause: pauseMutation.mutate,
      pauseAsync: pauseMutation.mutateAsync,
      resume: resumeMutation.mutate,
      resumeAsync: resumeMutation.mutateAsync,
      cancel: cancelMutation.mutate,
      cancelAsync: cancelMutation.mutateAsync,
      isDownloading: downloadMutation.isPending,
      isPausing: pauseMutation.isPending,
      isResuming: resumeMutation.isPending,
      isCanceling: cancelMutation.isPending
    }),
    [progress, downloadMutation, pauseMutation, resumeMutation, cancelMutation]
  )

  return <DownloadContext.Provider value={value}>{children}</DownloadContext.Provider>
}
