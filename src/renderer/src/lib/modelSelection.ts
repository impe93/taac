/**
 * Shared model-selection logic used by both the onboarding wizard and the
 * settings page, so the two never diverge on "which model is optimal".
 *
 * The registry may expose several variants for the same task (e.g. Whisper
 * base/small/large, Qwen3-ASR 1.7B/0.6B). Given the hardware tier we pick the
 * single optimal variant and surface the remaining *compatible* variants as
 * advanced alternatives.
 */

import type { ModelDefinition, HardwareTier } from '@main/ai/types'

export const TIER_RANK: Record<HardwareTier, number> = { low: 0, medium: 1, high: 2, ultra: 3 }

/**
 * A single whisper.cpp (GGML) engine handles both GPU and CPU, so the variant is
 * always GGML — the model size is chosen purely by hardware tier.
 */
export const pickWhisperId = (tier: HardwareTier): string => {
  if (TIER_RANK[tier] >= TIER_RANK['high']) return 'whisper-large-v3-turbo-ggml'
  if (TIER_RANK[tier] >= TIER_RANK['medium']) return 'whisper-small-ggml'
  return 'whisper-base-ggml'
}

/**
 * Realtime transcription model (Qwen3-ASR via MLX, Apple Silicon only) —
 * 1.7B for medium+ machines, 0.6B keeps low-tier machines responsive.
 */
export const pickAsrId = (tier: HardwareTier): string =>
  TIER_RANK[tier] >= TIER_RANK['medium'] ? 'qwen3-asr-1.7b-mlx-8bit' : 'qwen3-asr-0.6b-mlx-8bit'

/** A task whose optimal variant is highlighted, with compatible alternatives behind "Advanced". */
export interface ModelChoice {
  optimal: ModelDefinition
  alternatives: ModelDefinition[]
}

/** True when `model` runs on a machine of the given tier (its tier is at or below the user's). */
const isCompatibleWithTier = (model: ModelDefinition, tier: HardwareTier): boolean =>
  TIER_RANK[model.hardwareTier] <= TIER_RANK[tier]

/**
 * Build a `ModelChoice` for a task: the optimal model plus every *other* candidate
 * that is still compatible with the tier, sorted from lightest to heaviest.
 * Returns `null` when the optimal model isn't in the registry.
 */
const buildChoice = (
  optimalId: string,
  candidates: ModelDefinition[],
  tier: HardwareTier
): ModelChoice | null => {
  const byId = new Map(candidates.map((m) => [m.id, m]))
  const optimal = byId.get(optimalId)
  if (!optimal) return null

  const alternatives = candidates
    .filter((m) => m.id !== optimalId && isCompatibleWithTier(m, tier))
    .sort((a, b) => a.sizeBytes - b.sizeBytes)

  return { optimal, alternatives }
}

/** Whisper (GGML) transcription choice for the tier. */
export const getWhisperChoice = (
  availableModels: ModelDefinition[],
  tier: HardwareTier
): ModelChoice | null => {
  const whisper = availableModels.filter(
    (m) => m.capabilities.includes('transcription') && m.format === 'ggml'
  )
  return buildChoice(pickWhisperId(tier), whisper, tier)
}

/** Realtime ASR (MLX) choice — only meaningful on Apple Silicon. */
export const getAsrChoice = (
  availableModels: ModelDefinition[],
  tier: HardwareTier
): ModelChoice | null => {
  const asr = availableModels.filter(
    (m) => m.capabilities.includes('transcription') && m.format === 'mlx'
  )
  return buildChoice(pickAsrId(tier), asr, tier)
}
