/**
 * Token budget profiles for summarization, selected per `meeting.summaryDepth`.
 */

import type { SummaryBudget, SummaryDepth } from './types'

/**
 * Reference workload: a 90-minute Italian meeting is ~22k tokens of content plus
 * ~3k of turn timestamps ≈ 25k tokens.
 *
 * Every stage keeps `input + output + systemPrompt(~450) + framing(320)` well
 * inside `contextSize`, with ≥40% headroom left over. The headroom absorbs the
 * chars-per-token estimation error of the MLX token counter, which calibrates
 * once instead of tokenizing every chunk.
 *
 * Note that a smaller profile yields MORE chunks and therefore potentially more
 * granular details. The profiles trade how much context the model sees per
 * bullet (coherence) and how long each bullet may be — not the total amount of
 * output, which scales with the length of the recording either way.
 *
 * Caveat: on the MLX backend `contextSize` is ignored (see SummaryBudget), so
 * there the profiles affect chunking, quality and latency but not memory.
 */
export const SUMMARY_PROFILES: Record<SummaryDepth, SummaryBudget> = {
  conservative: {
    contextSize: 8192,
    chunkInputTokens: 3072,
    mapOutputTokens: 768,
    reduceInputTokens: 3072,
    reduceOutputTokens: 1024,
    speakerInputTokens: 2560,
    speakerOutputTokens: 512
  },
  balanced: {
    contextSize: 12288,
    chunkInputTokens: 4608,
    mapOutputTokens: 1280,
    reduceInputTokens: 5120,
    reduceOutputTokens: 1536,
    speakerInputTokens: 3584,
    speakerOutputTokens: 640
  },
  aggressive: {
    contextSize: 16384,
    chunkInputTokens: 6144,
    mapOutputTokens: 1792,
    reduceInputTokens: 7168,
    reduceOutputTokens: 2048,
    speakerInputTokens: 5120,
    speakerOutputTokens: 768
  }
}

/**
 * Resolve the active budget from the user's `meeting.summaryDepth` preference.
 * Falls back to the balanced profile when the config is missing or unreadable,
 * so summarization never breaks on a bad/legacy config value.
 */
export const resolveSummaryBudget = async (override?: SummaryDepth): Promise<SummaryBudget> => {
  if (override && SUMMARY_PROFILES[override]) return SUMMARY_PROFILES[override]
  try {
    const { configStore } = await import('../../utils/configStore')
    const depth = configStore.get('meeting')?.summaryDepth as SummaryDepth | undefined
    return (depth && SUMMARY_PROFILES[depth]) || SUMMARY_PROFILES.balanced
  } catch {
    return SUMMARY_PROFILES.balanced
  }
}
