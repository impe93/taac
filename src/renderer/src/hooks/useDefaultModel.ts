import { useMemo } from 'react'
import { useDownloadedModels } from './useModels'
import { useModelRecommendations } from './useHardware'

const FALLBACK_MODEL_ID = 'qwen3-4b-instruct-2507-q8'

/**
 * Hook to get a sensible default model ID based on:
 * 1. First downloaded chat model (user already invested in downloading it)
 * 2. First recommended chat model based on hardware
 * 3. Fallback to 'qwen2-1.5b-q8' (smallest model at 1.6GB)
 */
export const useDefaultModelId = (): string => {
  const { data: downloadedModels } = useDownloadedModels()
  const { data: recommendations } = useModelRecommendations()

  return useMemo(() => {
    // Priority 1: First downloaded chat model
    const downloadedChat = downloadedModels?.find((m) => m.capabilities.includes('chat'))
    if (downloadedChat) return downloadedChat.id

    // Priority 2: First recommended chat model (exclude embedding models)
    const recommendedChat = recommendations?.find(
      (r) => !r.modelId.includes('embed') && !r.modelId.includes('bge')
    )
    if (recommendedChat) return recommendedChat.modelId

    // Priority 3: Hardcoded fallback
    return FALLBACK_MODEL_ID
  }, [downloadedModels, recommendations])
}
