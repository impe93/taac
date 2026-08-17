/**
 * Final document assembly.
 *
 * The headings are written HERE, not by the model: the reduce step only supplies
 * the opening prose, and the details come from the map step. That makes the
 * structure of the note a property of the code rather than something the model
 * has to remember while it is also running out of output budget.
 */

import { renderDetails } from './detailsParser'
import type { DetailBullet, SummaryContentType } from './types'

export const DETAILS_HEADING = '## Details'
export const TRANSCRIPT_HEADING = '## Full Transcript'

/**
 * Required sections per content type, in order. The first two are produced by
 * the reduce step; the last one is assembled from the map output.
 *
 * Headings stay in English regardless of the meeting language so parsing (and
 * every downstream regex) has a single stable contract.
 */
export const SUMMARY_SECTIONS: Record<SummaryContentType, string[]> = {
  meeting: ['## Summary', '## Next steps', DETAILS_HEADING],
  media: ['## Overview', '## Key concepts', DETAILS_HEADING]
}

const HEADING_RE = /^##\s+\S/

/**
 * Cut anything the model appended past its remit — a details or transcript
 * section it decided to write on its own.
 */
const truncateReduceOutput = (text: string): string => {
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  for (const heading of [DETAILS_HEADING, TRANSCRIPT_HEADING]) {
    const index = out.indexOf(heading)
    if (index !== -1) out = out.slice(0, index).trimEnd()
  }
  return out
}

/**
 * Force the two opening headings to the expected English strings.
 *
 * Models translate headings into the body language often enough that matching on
 * the exact string is fragile. Matching POSITIONALLY — first heading found is
 * the first expected section, and so on — is robust regardless of what the model
 * called them.
 */
const normalizeHeadings = (text: string, expected: string[]): string => {
  const lines = text.split('\n')
  const headingIndices = lines
    .map((line, index) => (HEADING_RE.test(line.trim()) ? index : -1))
    .filter((index) => index !== -1)

  if (headingIndices.length === 0) {
    // No structure at all: treat the whole output as the first section.
    const body = text.trim()
    return [expected[0], '', body || '_Not available._', '', expected[1], '', '_None._'].join('\n')
  }

  headingIndices.forEach((lineIndex, position) => {
    if (position < expected.length) lines[lineIndex] = expected[position]
  })

  // Drop anything before the first heading (a preamble the model added).
  const normalized = lines.slice(headingIndices[0]).join('\n').trim()

  if (headingIndices.length === 1) {
    return `${normalized}\n\n${expected[1]}\n\n_None._`
  }
  return normalized
}

/**
 * Build the final note: the reduce output with canonical headings, followed by
 * the details section rendered from the map bullets.
 */
export const assembleDocument = (
  reduceOutput: string,
  bullets: DetailBullet[],
  contentType: SummaryContentType
): string => {
  const expected = SUMMARY_SECTIONS[contentType]
  const opening = normalizeHeadings(truncateReduceOutput(reduceOutput), expected)
  const details = bullets.length > 0 ? renderDetails(bullets) : '_Not available._'
  return `${opening}\n\n${DETAILS_HEADING}\n\n${details}\n`
}

/**
 * Count real body characters (excluding required headings, markdown symbols and
 * any leaked reasoning), to tell an empty summary from one that merely lost a
 * heading.
 */
export const summaryBodyLength = (text: string, contentType: SummaryContentType): number => {
  if (!text) return 0
  let body = text.replace(/<think>[\s\S]*?<\/think>/gi, '')
  for (const heading of SUMMARY_SECTIONS[contentType]) body = body.split(heading).join('')
  return body.replace(/[#\s_*\-[\]()]/g, '').length
}

/** Whether the document has every required section plus real body content. */
export const isValidSummary = (text: string, contentType: SummaryContentType): boolean => {
  if (!text) return false
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '')
  const hasAllSections = SUMMARY_SECTIONS[contentType].every((h) => cleaned.includes(h))
  if (!hasAllSections) return false
  return summaryBodyLength(cleaned, contentType) > 40
}

/**
 * Content used when summarization fails or is unavailable. Preserves the raw
 * transcript so the user never loses the meeting, and states the reason so the
 * failure is visible rather than silent.
 */
export const buildFallbackContent = (
  transcriptText: string,
  reason: string,
  contentType: SummaryContentType
): string => {
  const transcriptBlock = transcriptText.trim() ? transcriptText.trim() : '_No speech detected._'
  const lines: string[] = []
  SUMMARY_SECTIONS[contentType].forEach((heading, index) => {
    lines.push(heading, '', index === 0 ? `_${reason}_` : '_Not available._', '')
  })
  lines.push(TRANSCRIPT_HEADING, '', transcriptBlock)
  return lines.join('\n')
}
