import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { ModelDefinition } from '@main/ai/types'
import { useDownloadContext } from '@renderer/components/models/downloadContext'

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
 * Access app-wide model-download state (progress + download/pause/resume/cancel).
 *
 * The state lives in `DownloadProvider` (mounted once, high in the tree) so that
 * downloads started in one view (onboarding) stay visible in another (settings,
 * the top-bar indicator) and survive remounts. The main process keeps
 * transferring regardless; this is just the shared renderer-side mirror.
 */
export const useModelDownload = useDownloadContext

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
