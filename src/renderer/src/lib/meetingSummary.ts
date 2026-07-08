/**
 * Shared helpers for the meeting/media summary options surfaced both in Settings
 * (global default) and in the MeetingRecorder (per-recording override).
 *
 * The internal enum values (`conservative | balanced | aggressive`) are kept for
 * backward compatibility with the persisted `meeting.summaryDepth` config; the UI
 * relabels them as Short / Balanced / Detailed.
 */

import type { ModelProfile } from '@main/ai/types'

export type SummaryDepth = 'conservative' | 'balanced' | 'aggressive'
export type RecordingContentType = 'meeting' | 'media'
export type RecordingMode = 'remote' | 'in-person' | 'system-only'

export interface SummaryDepthOption {
  value: SummaryDepth
  label: string
  description: string
}

/**
 * User-facing summary length options, in ascending order of detail. The order
 * matters: the last one (`aggressive`) is the gated "Detailed" option.
 */
export const SUMMARY_DEPTH_OPTIONS: SummaryDepthOption[] = [
  {
    value: 'conservative',
    label: 'Short',
    description: 'Concise summary — fastest, lowest memory.'
  },
  {
    value: 'balanced',
    label: 'Balanced',
    description: 'A good balance of detail and speed. Recommended for most machines.'
  },
  {
    value: 'aggressive',
    label: 'Detailed',
    description: 'The most thorough summary — uses more memory and takes longer.'
  }
]

export const DEFAULT_SUMMARY_DEPTH: SummaryDepth = 'balanced'

/**
 * Context size (tokens) the "Detailed" profile requests. Mirrors
 * `AudioManager.SUMMARY_PROFILES.aggressive.contextSize`. A chat model whose
 * context is smaller cannot honour the profile, so Detailed is disabled.
 */
export const DETAILED_SUMMARY_CONTEXT = 24576

export const summaryDepthLabel = (depth: SummaryDepth): string =>
  SUMMARY_DEPTH_OPTIONS.find((o) => o.value === depth)?.label ?? depth

/**
 * Whether the "Detailed" (aggressive) summary length may be offered on this
 * machine. Disabled on low-end hardware OR when the active chat model's context
 * window cannot hold the Detailed profile — both would otherwise silently clamp
 * to a smaller effective summary or risk running out of memory.
 */
export const isDetailedSummaryAvailable = (profile: ModelProfile | undefined): boolean => {
  if (!profile) return false
  const tierOk = profile.hardware.tier !== 'low'
  const contextOk = (profile.features.chat.contextLength ?? 0) >= DETAILED_SUMMARY_CONTEXT
  return tierOk && contextOk
}

/**
 * Reason the "Detailed" option is unavailable, for a tooltip/hint. Empty string
 * when it is available.
 */
export const detailedUnavailableReason = (profile: ModelProfile | undefined): string => {
  if (!profile || isDetailedSummaryAvailable(profile)) return ''
  if (profile.hardware.tier === 'low') {
    return 'Detailed summaries need more memory than this machine has.'
  }
  return 'The active chat model’s context window is too small for detailed summaries.'
}

/**
 * Clamp a chosen depth to what is selectable: Detailed falls back to Balanced
 * when unavailable, so a stale config value never produces a broken selection.
 */
export const resolveSelectableDepth = (
  depth: SummaryDepth | undefined,
  detailedAvailable: boolean
): SummaryDepth => {
  const value = depth ?? DEFAULT_SUMMARY_DEPTH
  if (value === 'aggressive' && !detailedAvailable) return DEFAULT_SUMMARY_DEPTH
  return value
}
