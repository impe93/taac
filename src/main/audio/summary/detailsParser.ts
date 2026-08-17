/**
 * Parsing and post-processing of the map step output.
 *
 * The map step emits the final "## Details" bullets plus a candidate-action
 * block. Everything the model writes about TIME is treated as a suggestion:
 * timestamps are snapped to turn start times that really occur in the chunk, so
 * a plausible-looking invented timestamp cannot survive.
 */

import { formatTimestamp, parseTimestamp } from './transcriptFormat'
import type { CandidateAction, DetailBullet, TokenCounter, TranscriptChunk } from './types'

/** A bullet as written by the model, before its timestamp has been validated. */
export interface ParsedBullet {
  title: string
  body: string
  /** null when the model omitted or malformed the timestamp. */
  startTime: number | null
}

const BULLET_START_RE = /^\s*[-*+]\s+\*\*(.+?)\*\*\s*[:：]?\s*(.*)$/
const ACTIONS_MARKER_RE = /^\s*ACTIONS\s*:?\s*$/i
const TRAILING_TIME_RE = /\((\d{1,2}:\d{2}(?::\d{2})?)\)\s*[.。]?\s*$/
const ANY_TIME_RE = /\((\d{1,2}:\d{2}(?::\d{2})?)\)/g

/**
 * Split the raw map output into bullets and candidate actions.
 *
 * Tolerant by design: a missing ACTIONS block yields no actions, a bullet
 * wrapped over several lines is joined back together, and anything that does not
 * look like a bullet before the first one is ignored as preamble.
 */
export const parseMapOutput = (
  raw: string
): { bullets: ParsedBullet[]; actions: CandidateAction[] } => {
  const lines = raw.split('\n')
  const bullets: ParsedBullet[] = []
  const actions: CandidateAction[] = []

  let inActions = false
  let current: ParsedBullet | null = null

  const closeBullet = (): void => {
    if (!current) return
    const { body, startTime } = extractTime(current.body)
    bullets.push({ title: current.title.trim(), body, startTime })
    current = null
  }

  for (const line of lines) {
    if (ACTIONS_MARKER_RE.test(line)) {
      closeBullet()
      inActions = true
      continue
    }

    if (inActions) {
      const action = parseActionLine(line)
      if (action) actions.push(action)
      continue
    }

    const match = line.match(BULLET_START_RE)
    if (match) {
      closeBullet()
      current = { title: match[1], body: match[2] ?? '', startTime: null }
      continue
    }

    // Continuation of the current bullet (the model wrapped the paragraph).
    if (current && line.trim()) {
      current.body += `${current.body ? ' ' : ''}${line.trim()}`
    }
  }

  closeBullet()
  return { bullets, actions }
}

/** Pull the timestamp out of a bullet body, preferring the trailing one. */
const extractTime = (body: string): { body: string; startTime: number | null } => {
  const trimmed = body.trim()
  const trailing = trimmed.match(TRAILING_TIME_RE)
  if (trailing) {
    return {
      body: trimmed.slice(0, trailing.index).trim(),
      startTime: parseTimestamp(trailing[1])
    }
  }

  // Fall back to the last timestamp anywhere in the body — some models put it
  // mid-sentence. It is removed so it cannot be rendered twice.
  const all = [...trimmed.matchAll(ANY_TIME_RE)]
  if (all.length > 0) {
    const last = all[all.length - 1]
    const seconds = parseTimestamp(last[1])
    const cleaned = `${trimmed.slice(0, last.index)}${trimmed.slice((last.index ?? 0) + last[0].length)}`
    return { body: cleaned.replace(/\s{2,}/g, ' ').trim(), startTime: seconds }
  }

  return { body: trimmed, startTime: null }
}

const parseActionLine = (line: string): CandidateAction | null => {
  const trimmed = line.trim().replace(/^[-*+]\s+/, '')
  if (!trimmed || /^none$/i.test(trimmed)) return null

  const parts = trimmed.split('|').map((p) => p.trim())
  if (parts.length >= 3) {
    const assignee = parts[0] && parts[0] !== '-' ? parts[0] : undefined
    const title = parts[1]
    const description = parts.slice(2).join(' | ')
    return title ? { assignee, title, description } : null
  }
  if (parts.length === 2) {
    return parts[1] ? { title: parts[0], description: parts[1] } : null
  }
  return { title: trimmed, description: '' }
}

/**
 * Anchor every bullet to a turn that actually starts in this chunk.
 *
 * A timestamp outside the chunk range (or missing entirely) is replaced by the
 * turn matching the bullet's ordinal position; a timestamp inside the range is
 * snapped to the nearest real turn start.
 */
export const snapTimestamps = (bullets: ParsedBullet[], chunk: TranscriptChunk): DetailBullet[] => {
  const starts = chunk.turnStarts.length > 0 ? chunk.turnStarts : [chunk.startTime]

  return bullets.map((bullet, index) => {
    const proposed = bullet.startTime
    const inRange = proposed !== null && proposed >= chunk.startTime && proposed <= chunk.endTime

    if (!inRange) {
      // Spread the bullets across the chunk's turns by position.
      const ratio = bullets.length > 1 ? index / bullets.length : 0
      const fallback = starts[Math.min(starts.length - 1, Math.floor(ratio * starts.length))]
      return { title: bullet.title, body: bullet.body, startTime: fallback }
    }

    const nearest = starts.reduce((best, start) =>
      Math.abs(start - proposed) < Math.abs(best - proposed) ? start : best
    )
    return { title: bullet.title, body: bullet.body, startTime: nearest }
  })
}

const normalizeTitle = (title: string): string =>
  title
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Drop a bullet whose title repeats one of the previous few. Chunk boundaries
 * are the usual cause: the same topic gets opened again on the other side of the
 * cut despite the "continue, do not repeat" instruction.
 */
export const dedupeAdjacentBullets = (bullets: DetailBullet[]): DetailBullet[] => {
  const out: DetailBullet[] = []
  for (const bullet of bullets) {
    const key = normalizeTitle(bullet.title)
    const isDuplicate = out
      .slice(-3)
      .some((previous) => key.length > 0 && normalizeTitle(previous.title) === key)
    if (!isDuplicate) out.push(bullet)
  }
  return out
}

/** Force non-decreasing timestamps so the details always read chronologically. */
export const enforceMonotonic = (bullets: DetailBullet[]): DetailBullet[] => {
  let previous = 0
  return bullets.map((bullet) => {
    const startTime = Math.max(previous, bullet.startTime)
    previous = startTime
    return { ...bullet, startTime }
  })
}

/** Render the assembled "## Details" section body. */
export const renderDetails = (bullets: DetailBullet[]): string =>
  bullets
    .map((b) => {
      const body = b.body ? ` ${b.body}` : ''
      return `* **${b.title}**:${body} (${formatTimestamp(b.startTime)})`
    })
    .join('\n\n')

const firstSentence = (text: string): string => {
  const match = text.match(/^[\s\S]*?[.!?](\s|$)/)
  const sentence = (match ? match[0] : text).trim()
  return sentence.length > 200 ? `${sentence.slice(0, 197).trimEnd()}...` : sentence
}

/**
 * Build the topic outline handed to the reduce step, compacted just enough to
 * fit its input budget.
 *
 * Three deterministic levels — full bullets, title plus first sentence, titles
 * only — replace the old LLM collapse loop, which cost extra calls and degraded
 * the notes every time it ran.
 */
export const buildDetailsOutline = (
  bullets: DetailBullet[],
  budgetTokens: number,
  countTokens: TokenCounter
): string => {
  const levels = [
    (b: DetailBullet): string => `- **${b.title}**: ${b.body}`,
    (b: DetailBullet): string => `- **${b.title}**: ${firstSentence(b.body)}`,
    (b: DetailBullet): string => `- **${b.title}**`
  ]

  let rendered = ''
  for (const render of levels) {
    rendered = bullets.map(render).join('\n')
    if (countTokens(rendered) <= budgetTokens) return rendered
  }

  // Even titles alone overflow (a very long meeting): hard-truncate so the
  // reduce call can never overflow its context.
  const perChar = countTokens(rendered) / Math.max(1, rendered.length)
  const maxChars = Math.floor(budgetTokens / Math.max(perChar, 1e-6))
  return rendered.slice(0, maxChars)
}

/** Render candidate actions for the reduce prompt, dropping duplicates. */
export const renderCandidateActions = (actions: CandidateAction[]): string => {
  const seen = new Set<string>()
  const lines: string[] = []
  for (const action of actions) {
    const key = normalizeTitle(`${action.assignee ?? ''} ${action.title}`)
    if (seen.has(key)) continue
    seen.add(key)
    lines.push(`${action.assignee ?? '-'} | ${action.title} | ${action.description}`.trim())
  }
  return lines.join('\n')
}
