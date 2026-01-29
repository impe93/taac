import { useQuery } from '@tanstack/react-query'
import type { HardwareInfo, ModelRecommendation, ModelDefinition } from '@main/ai/types'

/**
 * Query hardware information (CPU, RAM, GPU)
 * Hardware doesn't change during runtime, so staleTime is Infinity
 */
export const useHardwareInfo = () => {
  return useQuery<HardwareInfo>({
    queryKey: ['ai', 'hardware'],
    queryFn: () => window.ai.getHardwareInfo(),
    staleTime: Infinity
  })
}

/**
 * Query model recommendations based on detected hardware
 * Recommendations are based on hardware which doesn't change, so staleTime is Infinity
 */
export const useModelRecommendations = () => {
  return useQuery<ModelRecommendation[]>({
    queryKey: ['ai', 'recommendations'],
    queryFn: () => window.ai.getModelRecommendations(),
    staleTime: Infinity
  })
}

/**
 * Query list of all available models in the curated registry
 * The model registry is static, so staleTime is Infinity
 */
export const useAvailableModels = () => {
  return useQuery<ModelDefinition[]>({
    queryKey: ['ai', 'models', 'available'],
    queryFn: () => window.ai.listAvailableModels(),
    staleTime: Infinity
  })
}
