import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { ModelDefinition, DownloadProgress } from '@main/ai/types'

/**
 * Query list of downloaded models
 */
export const useDownloadedModels = () => {
  return useQuery<ModelDefinition[]>({
    queryKey: ['ai', 'models', 'downloaded'],
    queryFn: () => window.ai.listDownloadedModels()
  })
}

/**
 * Hook for managing model downloads with real-time progress tracking
 *
 * Features:
 * - Real-time progress updates via IPC events
 * - Download/pause/resume/cancel mutations
 * - Automatic query invalidation on completion
 */
export const useModelDownload = () => {
  const queryClient = useQueryClient()
  const [progress, setProgress] = useState<Map<string, DownloadProgress>>(new Map())

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

  return {
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
  }
}

/**
 * Mutation for deleting a downloaded model
 */
export const useDeleteModel = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (modelId: string) => window.ai.deleteModel(modelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai', 'models', 'downloaded'] })
    }
  })
}
