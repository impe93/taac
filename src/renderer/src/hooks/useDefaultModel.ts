import { useModelProfile } from './useHardware'

/**
 * Hook to get the default chat model ID for this machine.
 *
 * Derived from the hardware-aware ModelProfile so Apple Silicon resolves to the
 * MLX chat model and other platforms to the GGUF one (see
 * ModelSelector.resolveChatId). Falls back to the GGUF id until the profile
 * query resolves (loads once at app start with staleTime Infinity).
 */
export const useDefaultModelId = (): string => {
  const { data: profile } = useModelProfile()
  return profile?.features.chat.id ?? 'qwen3-5-4b-q4-k-m'
}
