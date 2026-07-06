import { useQuery } from '@tanstack/react-query'
import type { HardwareInfo, ModelProfile } from '@main/ai/types'

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
 * Query hardware-aware model profile for Settings and onboarding.
 * Profile is static for the session, so staleTime is Infinity.
 */
export const useModelProfile = () => {
  return useQuery<ModelProfile>({
    queryKey: ['ai', 'model-profile'],
    queryFn: () => window.ai.getModelProfile(),
    staleTime: Infinity
  })
}

/**
 * Query list of all available models in the curated registry
 * The model registry is static, so staleTime is Infinity
 */
export const useAvailableModels = () => {
  return useQuery({
    queryKey: ['ai', 'models', 'available'],
    queryFn: () => window.ai.listAvailableModels(),
    staleTime: Infinity
  })
}
