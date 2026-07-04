/**
 * Duration-weighted majority vote over per-utterance detected languages.
 *
 * Qwen3-ASR detects the language per utterance; a meeting-level language is
 * needed for MeetingMetadata and the summary prompt. Weighting by utterance
 * duration keeps short interjections in another language ("ok", "yes") from
 * outvoting the dominant spoken language.
 */

export interface LanguageVoteSegment {
  /** Normalized ISO 639-1 code, '' when unknown */
  language: string
  startTime: number
  endTime: number
}

/**
 * Return the dominant language code, or '' when no segment carries one.
 */
export function majorityLanguage(segments: LanguageVoteSegment[]): string {
  const weights = new Map<string, number>()

  for (const segment of segments) {
    if (!segment.language) continue
    const duration = Math.max(0, segment.endTime - segment.startTime)
    weights.set(segment.language, (weights.get(segment.language) ?? 0) + duration)
  }

  let bestLanguage = ''
  let bestWeight = 0
  for (const [language, weight] of weights) {
    if (weight > bestWeight) {
      bestLanguage = language
      bestWeight = weight
    }
  }

  return bestLanguage
}
