/**
 * Cross-talk (acoustic echo) detection between meeting audio tracks.
 *
 * Without headphones the microphone picks up the speakers' output, so remote
 * speech appears on BOTH tracks: clean on the system track and as an echo on
 * the mic track (where it would also be mis-attributed to "You").
 *
 * Detection is text-based containment rather than pairwise similarity because
 * segment boundaries differ between tracks — especially on the realtime path,
 * where a single 20s mic VAD utterance can correspond to several short system
 * utterances. For each candidate segment the tokens of ALL other-track
 * segments overlapping in time (±tolerance) are pooled; if enough of the
 * candidate's tokens appear in that pool, it is an echo copy.
 */

export interface TimedText {
  startTime: number
  endTime: number
  text: string
}

/** VAD/ASR boundaries and acoustic latency shift copies by up to a couple of seconds */
const TIME_TOLERANCE_SECS = 2

/** Fraction of a segment's tokens that must appear in the other track's pool */
const CONTAINMENT_THRESHOLD = 0.7

/** Segments this short ("ok", "sì") must be fully contained to count as echo */
const SHORT_SEGMENT_TOKENS = 3

/** Lowercase, strip punctuation, split on whitespace */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * True when `segment` looks like an acoustic-echo copy of speech already
 * present on the other track in the same time window.
 */
export function isCrossTalkDuplicate(segment: TimedText, otherTrack: TimedText[]): boolean {
  const tokens = tokenize(segment.text)
  if (tokens.length === 0) return false

  // Pool the other track's tokens from the overlapping window (multiset —
  // "sì sì sì" must not match a single "sì")
  const pool = new Map<string, number>()
  for (const other of otherTrack) {
    const overlaps =
      segment.startTime <= other.endTime + TIME_TOLERANCE_SECS &&
      segment.endTime >= other.startTime - TIME_TOLERANCE_SECS
    if (!overlaps) continue
    for (const token of tokenize(other.text)) {
      pool.set(token, (pool.get(token) ?? 0) + 1)
    }
  }
  if (pool.size === 0) return false

  let matched = 0
  for (const token of tokens) {
    const available = pool.get(token) ?? 0
    if (available > 0) {
      matched++
      pool.set(token, available - 1)
    }
  }

  const containment = matched / tokens.length
  if (tokens.length <= SHORT_SEGMENT_TOKENS) {
    return containment === 1
  }
  return containment >= CONTAINMENT_THRESHOLD
}
