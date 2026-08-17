/**
 * Turning raw transcription segments into prompt-ready text.
 *
 * The central idea is the "turn": consecutive segments of the same speaker are
 * merged into one line carrying only a START timestamp. Whisper emits a segment
 * every few seconds, so the previous one-line-per-segment format spent ~14k
 * tokens of a 90-minute meeting on timestamps alone and handed the model
 * sentences cut in half. Turns cost ~3k instead and read as a dialogue.
 */

import type { Speaker, TranscriptionSegment } from '../../../preload/types'
import type { TokenCounter, TranscriptChunk, Turn } from './types'

/** Close a turn when the speaker is silent for longer than this. */
const DEFAULT_MAX_GAP_SECS = 30

/** Close a turn beyond this length so one monologue cannot fill a whole chunk. */
const DEFAULT_MAX_TURN_CHARS = 2400

/** Labels the diarizer produces before any name resolution has happened. */
const GENERIC_LABEL_RE = /^(Speaker \d+|You(?: \(\d+\))?)$/

/** Format seconds as HH:MM:SS (hours included — meetings do run past 60 minutes). */
export const formatTimestamp = (secs: number): string => {
  const total = Math.max(0, Math.floor(secs))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':')
}

/** Parse an HH:MM:SS or MM:SS timestamp back into seconds; null when malformed. */
export const parseTimestamp = (value: string): number | null => {
  const parts = value.split(':').map((p) => Number.parseInt(p, 10))
  if (parts.some((p) => Number.isNaN(p))) return null
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return null
}

/**
 * Merge consecutive segments of the same speaker into turns. A turn ends when
 * the speaker changes, the silence exceeds `maxGapSecs` (a long pause almost
 * always means a change of topic), or the accumulated text gets too long.
 */
export const mergeIntoTurns = (
  segments: TranscriptionSegment[],
  speakers: Speaker[],
  opts?: { maxGapSecs?: number; maxTurnChars?: number }
): Turn[] => {
  const maxGap = opts?.maxGapSecs ?? DEFAULT_MAX_GAP_SECS
  const maxChars = opts?.maxTurnChars ?? DEFAULT_MAX_TURN_CHARS
  const labels = new Map<string, string>(speakers.map((s) => [s.id, s.label]))

  const turns: Turn[] = []
  let current: Turn | null = null

  for (const segment of segments) {
    const text = segment.text.trim()
    if (!text) continue

    const sameSpeaker = current?.speakerId === segment.speakerId
    const gap = current ? segment.startTime - current.endTime : 0
    const fits = current ? current.text.length + text.length + 1 <= maxChars : false

    if (current && sameSpeaker && gap <= maxGap && fits) {
      current.text += ` ${text}`
      current.endTime = segment.endTime
      continue
    }

    if (current) turns.push(current)
    current = {
      speakerId: segment.speakerId,
      label: labels.get(segment.speakerId) ?? segment.speakerId,
      startTime: segment.startTime,
      endTime: segment.endTime,
      text
    }
  }

  if (current) turns.push(current)
  return turns
}

/** Render one turn as `[HH:MM:SS] Label: text`. */
const renderTurn = (turn: Turn, labelOverride?: Map<string, string>): string => {
  const label = labelOverride?.get(turn.speakerId) ?? turn.label
  return `[${formatTimestamp(turn.startTime)}] ${label}: ${turn.text}`
}

/** Render turns as the prompt-facing transcript. */
export const renderTurns = (turns: Turn[], labelOverride?: Map<string, string>): string =>
  turns.map((t) => renderTurn(t, labelOverride)).join('\n')

/**
 * Split turns into token-budgeted chunks, never cutting a turn in half. Each
 * chunk carries the real start times of its turns so the model's timestamps can
 * be snapped to something that actually happened.
 */
export const chunkTurns = (
  turns: Turn[],
  budgetTokens: number,
  countTokens: TokenCounter,
  labelOverride?: Map<string, string>
): TranscriptChunk[] => {
  if (turns.length === 0) return []

  const lines = turns.map((t) => renderTurn(t, labelOverride))
  const fullText = lines.join('\n')
  // Estimate tokens-per-char once instead of tokenizing every line: on the MLX
  // backend each count is an IPC round-trip.
  const perChar = countTokens(fullText) / Math.max(1, fullText.length)

  const chunks: TranscriptChunk[] = []
  let buffer: string[] = []
  let turnStarts: number[] = []
  let tokens = 0
  let startTime = turns[0].startTime
  let endTime = turns[0].endTime

  const flush = (): void => {
    if (buffer.length === 0) return
    chunks.push({ text: buffer.join('\n'), startTime, endTime, turnStarts })
    buffer = []
    turnStarts = []
    tokens = 0
  }

  for (let i = 0; i < turns.length; i++) {
    const lineTokens = Math.ceil((lines[i].length + 1) * perChar)
    if (tokens + lineTokens > budgetTokens && buffer.length > 0) {
      flush()
      startTime = turns[i].startTime
    }
    if (buffer.length === 0) startTime = turns[i].startTime
    buffer.push(lines[i])
    turnStarts.push(turns[i].startTime)
    endTime = turns[i].endTime
    tokens += lineTokens
  }

  flush()
  return chunks
}

/**
 * Speaker ids that still carry a diarizer-generated label, i.e. the ones worth
 * asking the model to name.
 */
export const genericSpeakers = (speakers: Speaker[]): Speaker[] =>
  speakers.filter((s) => GENERIC_LABEL_RE.test(s.label))

/**
 * Letter-based prompt labels (`Speaker A`, `Speaker B`, …) for clusters that
 * could not be named.
 *
 * They stay DISTINCT rather than collapsing into one anonymous label: the model
 * still needs to see who is answering whom. They are typographically unlike the
 * numeric diarizer labels, which makes the "never write this label" instruction
 * easier to follow and any leak trivial to spot.
 */
export const anonymousLabelMap = (speakers: Speaker[]): Map<string, string> => {
  const map = new Map<string, string>()
  speakers.forEach((speaker, index) => {
    let n = index
    let letters = ''
    do {
      letters = String.fromCharCode(65 + (n % 26)) + letters
      n = Math.floor(n / 26) - 1
    } while (n >= 0)
    map.set(speaker.id, `Speaker ${letters}`)
  })
  return map
}

/**
 * Build a high-evidence sample for speaker name resolution.
 *
 * Rather than paying 7-14 LLM calls to walk the whole transcript, we assemble
 * the places where names actually surface:
 *   - the opening turns (greetings, self-introductions, round of names);
 *   - every later turn containing a mid-sentence capitalised word, together with
 *     the turn right after it — that adjacency is what resolves a vocative
 *     ("Alessandro, cosa ne pensi?" is followed by Alessandro speaking).
 * Candidates are sampled evenly across the recording so a name introduced late
 * is not systematically missed.
 */
export const buildSpeakerEvidenceSample = (
  turns: Turn[],
  budgetTokens: number,
  countTokens: TokenCounter,
  labelOverride?: Map<string, string>
): string => {
  if (turns.length === 0) return ''

  const lines = turns.map((t) => renderTurn(t, labelOverride))
  const fullText = lines.join('\n')
  const perChar = countTokens(fullText) / Math.max(1, fullText.length)
  const lineTokens = (i: number): number => Math.ceil((lines[i].length + 1) * perChar)

  // ~40% of the budget goes to the opening, where introductions live.
  const introBudget = Math.floor(budgetTokens * 0.4)
  const selected = new Set<number>()
  let used = 0

  for (let i = 0; i < turns.length && used < introBudget; i++) {
    selected.add(i)
    used += lineTokens(i)
  }
  const introEnd = selected.size

  // Candidate turns: a capitalised word that is not sentence-initial.
  const candidates: number[] = []
  for (let i = introEnd; i < turns.length; i++) {
    if (hasMidSentenceCapital(turns[i].text)) candidates.push(i)
  }

  // Sample candidates evenly across the remaining timeline: work out how many
  // fit in the leftover budget, then stride through the list so the selection
  // spans the whole recording instead of stopping at the first few.
  if (candidates.length > 0) {
    const avgCost =
      candidates.reduce(
        (sum, i) => sum + lineTokens(i) + (i + 1 < turns.length ? lineTokens(i + 1) : 0),
        0
      ) / candidates.length
    const affordable = Math.max(1, Math.floor((budgetTokens - used) / Math.max(avgCost, 1)))
    const step = Math.max(1, Math.ceil(candidates.length / affordable))

    for (let c = 0; c < candidates.length; c += step) {
      const i = candidates[c]
      const cost = lineTokens(i) + (i + 1 < turns.length ? lineTokens(i + 1) : 0)
      if (used + cost > budgetTokens) break
      selected.add(i)
      if (i + 1 < turns.length) selected.add(i + 1)
      used += cost
    }
  }

  const ordered = [...selected].sort((a, b) => a - b)
  const out: string[] = []
  let previous = -1
  for (const i of ordered) {
    if (previous !== -1 && i > previous + 1) out.push('[...]')
    out.push(lines[i])
    previous = i
  }
  return out.join('\n')
}

/**
 * Whether the text contains a capitalised word that is not at the start of a
 * sentence — the cheap signal for "somebody is being named here".
 */
const hasMidSentenceCapital = (text: string): boolean => {
  const re = /\p{Lu}\p{Ll}{2,}/gu
  for (const match of text.matchAll(re)) {
    const at = match.index ?? 0
    if (at === 0) continue
    const before = text.slice(Math.max(0, at - 2), at)
    // Skip sentence starts: ". Word", "! Word", "? Word", ": Word", newline.
    if (/[.!?:\n]\s?$/.test(before)) continue
    return true
  }
  return false
}
