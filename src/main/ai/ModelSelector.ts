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

const CHAT_ID = 'qwen3-5-2b-q8'
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

/** Realtime ASR requires macOS on Apple Silicon (same gate as realtime/availability.ts). */
export const supportsRealtimeAsr = (hardware: HardwareInfo): boolean =>
  hardware.platform === 'darwin' && process.arch === 'arm64'

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
    const realtimeAsr = supportsRealtimeAsr(hardware)
    const compatibleModels = ModelRegistry.getModelsForTier(tier)

    const chat = requireModel(CHAT_ID)
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
      if (m.format === 'mlx' && !realtimeAsr) return false
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
