/**
 * Extraction of structured action items from the generated markdown.
 *
 * Scoped to the follow-up section only. The previous implementation matched
 * checkbox lines anywhere in the document, which would now also swallow any
 * checkbox the user types into the note by hand.
 */

import { randomUUID } from 'node:crypto'
import type { ActionItem } from '../../../preload/types'

export const NEXT_STEPS_HEADING = '## Next steps'

/** Heading used before the summary structure was reworked; still on disk. */
export const LEGACY_ACTION_HEADING = '## Action Items'

/**
 * Checkbox lines. The marker is `[-*+]` rather than a literal `-` because
 * MDXEditor re-serialises lists with `*`: a note the user edited and saved comes
 * back with a different marker than the one we wrote.
 */
const CHECKBOX_RE = /^\s*[-*+]\s+\[([ xX])\]\s+(.+)$/

/** First ` - ` / ` — ` / ` – ` separating the assignee from the action. */
const ASSIGNEE_SEPARATOR_RE = /\s+[-—–]\s+/

const LEGACY_ASSIGNEE_RE = /[—-]{1,2}\s*Assigned to:\s*([^—-]+)/i

/** Slice out the lines belonging to the follow-up section. */
const extractSection = (markdown: string): string[] => {
  const lines = markdown.split('\n')
  const headingIndex = lines.findIndex((line) => {
    const trimmed = line.trim()
    return trimmed === NEXT_STEPS_HEADING || trimmed === LEGACY_ACTION_HEADING
  })
  if (headingIndex === -1) return []

  const rest = lines.slice(headingIndex + 1)
  const end = rest.findIndex((line) => line.trimStart().startsWith('## '))
  return end === -1 ? rest : rest.slice(0, end)
}

/**
 * Parse the follow-up section into structured items.
 *
 * Two accepted shapes:
 *   - new:    `- [ ] Alessandro - Contattare il fornitore: inviare la richiesta.`
 *   - legacy: `- [ ] Contattare il fornitore — Assigned to: Alessandro`
 */
export const parseActionItems = (markdown: string): ActionItem[] => {
  const items: ActionItem[] = []

  for (const line of extractSection(markdown)) {
    const match = line.match(CHECKBOX_RE)
    if (!match) continue

    const completed = match[1].toLowerCase() === 'x'
    const raw = match[2].trim()
    if (!raw) continue

    if (LEGACY_ASSIGNEE_RE.test(raw)) {
      const assigneeMatch = raw.match(LEGACY_ASSIGNEE_RE)
      const textMatch = raw.match(/^(.+?)(?:\s*[—-]|$)/)
      items.push({
        id: randomUUID(),
        text: textMatch ? textMatch[1].trim() : raw,
        assignee: assigneeMatch ? assigneeMatch[1].trim() : undefined,
        completed
      })
      continue
    }

    const separator = raw.match(ASSIGNEE_SEPARATOR_RE)
    // Only treat the left side as an assignee when it looks like a name: a short
    // phrase without a colon. Otherwise the whole line is the action text.
    if (separator?.index !== undefined) {
      const candidate = raw.slice(0, separator.index).trim()
      const rest = raw.slice(separator.index + separator[0].length).trim()
      const isName = candidate.length > 0 && !candidate.includes(':') && wordCount(candidate) <= 5
      if (isName && rest) {
        items.push({ id: randomUUID(), text: rest, assignee: candidate, completed })
        continue
      }
    }

    items.push({ id: randomUUID(), text: raw, completed })
  }

  return items
}

const wordCount = (text: string): number => text.split(/\s+/).filter(Boolean).length
