/**
 * ModelSelector — hardware-aware model profile for Settings and onboarding.
 *
 * Single source of truth for which models are optimal, compatible, and
 * platform-available on the current machine.
 */

import { ModelRegistry } from './ModelRegistry'
import type { HardwareInfo, HardwareTier, ModelDefinition, ModelProfile } from './types'

export const TIER_RANK: Record<HardwareTier, number> = { low: 0, medium: 1, high: 2, ultra: 3 }

const DIARIZATION_IDS = [
  'sherpa-onnx-pyannote-segmentation',
  'sherpa-onnx-nemo-titanet-small'
] as const

/** GGUF chat model (node-llama-cpp) — used on Windows/Linux and non-Apple-Silicon. */
export const GGUF_CHAT_ID = 'qwen3-5-4b-q4-k-m'
/** MLX chat model (Python sidecar) — preferred on Apple Silicon. Same base model. */
export const MLX_CHAT_ID = 'qwen3-5-4b-mlx-4bit'
const EMBEDDING_ID = 'embeddinggemma-300m-q8'
const RERANKER_ID = 'qwen3-reranker-0.6b-q8'
const VAD_ID = 'silero-vad-onnx'

/**
 * A single whisper.cpp (GGML) engine handles both GPU and CPU — variant is
 * chosen purely by hardware tier.
 */
export const pickWhisperId = (tier: HardwareTier): string => {
  if (TIER_RANK[tier] >= TIER_RANK['high']) return 'whisper-large-v3-turbo-ggml'
  if (TIER_RANK[tier] >= TIER_RANK['medium']) return 'whisper-small-ggml'
  return 'whisper-base-ggml'
}

/** Realtime ASR (Qwen3-ASR via MLX, Apple Silicon only). */
export const pickAsrId = (tier: HardwareTier): string =>
  TIER_RANK[tier] >= TIER_RANK['medium'] ? 'qwen3-asr-1.7b-mlx-8bit' : 'qwen3-asr-0.6b-mlx-8bit'

/**
 * MLX inference (Python sidecar) requires macOS on Apple Silicon. Shared gate
 * for realtime ASR and MLX LLM text generation.
 */
export const supportsMlx = (hardware: HardwareInfo): boolean =>
  hardware.platform === 'darwin' && process.arch === 'arm64'

/** Realtime ASR requires macOS on Apple Silicon (same gate as realtime/availability.ts). */
export const supportsRealtimeAsr = supportsMlx

/**
 * Resolve the chat/summary model id for this machine. On Apple Silicon the MLX
 * variant (routed through the LLM sidecar) is used; elsewhere the GGUF variant
 * (node-llama-cpp). Single source of truth for every chat-model consumer.
 */
export const resolveChatId = (hardware: HardwareInfo): string =>
  supportsMlx(hardware) ? MLX_CHAT_ID : GGUF_CHAT_ID

const requireModel = (id: string): ModelDefinition => {
  const model = ModelRegistry.getModel(id)
  if (!model) throw new Error(`Required model not found in registry: ${id}`)
  return model
}

const buildAlternatives = (
  optimalId: string,
  candidates: ModelDefinition[],
  tier: HardwareTier
): ModelDefinition[] =>
  candidates
    .filter((m) => m.id !== optimalId && ModelRegistry.isCompatible(m.id, tier))
    .sort((a, b) => a.sizeBytes - b.sizeBytes)

export class ModelSelector {
  static getModelProfile(hardware: HardwareInfo): ModelProfile {
    const tier = hardware.tier
    const mlx = supportsMlx(hardware)
    const realtimeAsr = mlx
    const compatibleModels = ModelRegistry.getModelsForTier(tier)

    const chat = requireModel(resolveChatId(hardware))
    const embedding = requireModel(EMBEDDING_ID)
    const reranker = requireModel(RERANKER_ID)

    const whisperCandidates = compatibleModels.filter(
      (m) => m.capabilities.includes('transcription') && m.format === 'ggml'
    )
    const whisperOptimalId = pickWhisperId(tier)
    const whisper = requireModel(whisperOptimalId)

    const asrCandidates = compatibleModels.filter(
      (m) => m.capabilities.includes('transcription') && m.format === 'mlx'
    )
    const asrOptimalId = pickAsrId(tier)
    const asr = realtimeAsr ? requireModel(asrOptimalId) : undefined
    const vad = realtimeAsr ? requireModel(VAD_ID) : undefined
    const diarization = DIARIZATION_IDS.map((id) => requireModel(id))

    const compatibleModelsForUi = compatibleModels.filter((m) => {
      // MLX models (chat + realtime ASR) require Apple Silicon
      if (m.format === 'mlx' && !mlx) return false
      // On Apple Silicon, force the MLX chat variant: the GGUF chat model is
      // neither downloadable nor used (there is an MLX alternative).
      if (mlx && m.id === GGUF_CHAT_ID) return false
      return true
    })

    return {
      hardware,
      supportsRealtimeAsr: realtimeAsr,
      features: {
        chat,
        search: { embedding, reranker },
        meeting: { whisper, asr, vad, diarization }
      },
      alternatives: {
        whisper: buildAlternatives(whisperOptimalId, whisperCandidates, tier),
        asr: realtimeAsr ? buildAlternatives(asrOptimalId, asrCandidates, tier) : []
      },
      compatibleModels: compatibleModelsForUi
    }
  }
}
