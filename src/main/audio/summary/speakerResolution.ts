/**
 * Naming the diarizer's speaker clusters from the words actually spoken.
 *
 * The diarizer over-segments badly — a four-person meeting can produce twenty
 * clusters — and it has no way to know who a voice belongs to. Asking the model
 * to read the names off the transcript fixes both problems at once: clusters
 * that resolve to the same person get merged.
 *
 * Everything the model returns is treated as a claim to be verified. A name is
 * accepted only when it is genuinely spoken in the recording, because inventing
 * a plausible name — and then attributing a decision to that person — is far
 * worse than leaving a speaker unnamed.
 */

import type { Speaker, TranscriptionSegment } from '../../../preload/types'
import type { SpeakerNameMapping, SpeakerResolutionResult } from './types'

const UNKNOWN_RE = /^(unknown|n\/a|none|-|\?)$/i

/** Capitalised words that are never a person's name in this position. */
const STOP_WORDS = new Set([
  'speaker',
  'unknown',
  'participant',
  'group',
  'everyone',
  'team',
  'you',
  'the'
])

const MIN_NAME_LENGTH = 3

/** Share of an evidence quote's words that must occur in the transcript. */
const EVIDENCE_MATCH_RATIO = 0.6

/** Lowercase, strip accents and punctuation, collapse whitespace. */
const normalize = (text: string): string =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Whether `needle` occurs in `haystack` on word boundaries. */
const containsWords = (haystack: string, needle: string): boolean => {
  if (!needle) return false
  return ` ${haystack} `.includes(` ${needle} `)
}

/**
 * Parse the `<tag> | <name> | <evidence>` lines. Tolerant: unknown tags, missing
 * fields and stray prose are dropped rather than failing the whole step.
 */
export const parseSpeakerMappings = (raw: string, validTags: string[]): SpeakerNameMapping[] => {
  const tagByKey = new Map(validTags.map((tag) => [normalize(tag), tag]))
  const mappings: SpeakerNameMapping[] = []
  const seen = new Set<string>()

  for (const line of raw.split('\n')) {
    const parts = line.split('|').map((p) => p.trim())
    if (parts.length < 2) continue

    const tag = tagByKey.get(normalize(parts[0].replace(/^[-*+]\s*/, '')))
    if (!tag || seen.has(tag)) continue

    const name = parts[1].replace(/^["'`]|["'`]$/g, '').trim()
    if (!name || UNKNOWN_RE.test(name)) continue

    const evidence = (parts[2] ?? '').replace(/^["'`]|["'`]$/g, '').trim()
    seen.add(tag)
    mappings.push({ tag, name, evidence })
  }

  return mappings
}

/**
 * Keep only the mappings that hold up against the transcript:
 *   1. the name is literally spoken in the recording;
 *   2. it is not a capitalised non-name;
 *   3. the supporting quote really occurs (matched loosely on words, since a
 *      model paraphrases quotes more often than it fabricates names).
 *
 * Condition 1 is the one that matters: it is what makes a hallucinated name
 * impossible rather than merely unlikely.
 */
export const validateMappings = (
  mappings: SpeakerNameMapping[],
  transcriptText: string
): SpeakerNameMapping[] => {
  const haystack = normalize(transcriptText)
  const accepted: SpeakerNameMapping[] = []

  for (const mapping of mappings) {
    const name = normalize(mapping.name)
    const tokens = name.split(' ').filter(Boolean)

    if (name.length < MIN_NAME_LENGTH || tokens.length === 0) {
      console.warn(`[SpeakerResolution] Rejected "${mapping.name}" — too short`)
      continue
    }
    if (tokens.every((t) => STOP_WORDS.has(t))) {
      console.warn(`[SpeakerResolution] Rejected "${mapping.name}" — not a name`)
      continue
    }
    // The full name, or at least the first name, must be spoken.
    if (!containsWords(haystack, name) && !containsWords(haystack, tokens[0])) {
      console.warn(`[SpeakerResolution] Rejected "${mapping.name}" — not found in transcript`)
      continue
    }
    if (mapping.evidence && !UNKNOWN_RE.test(mapping.evidence)) {
      const words = normalize(mapping.evidence).split(' ').filter(Boolean)
      const hits = words.filter((w) => containsWords(haystack, w)).length
      if (words.length > 0 && hits / words.length < EVIDENCE_MATCH_RATIO) {
        console.warn(`[SpeakerResolution] Rejected "${mapping.name}" — evidence not found`)
        continue
      }
    }

    accepted.push({ ...mapping, name: mapping.name.trim() })
  }

  return accepted
}

/**
 * Pick the canonical name for a group of equivalent names: the longest one, so
 * "Alessandro" and "Alessandro Viglione" both end up as the full name.
 */
const canonicalName = (names: string[]): string =>
  names.reduce((best, name) => (name.length > best.length ? name : best), names[0])

/**
 * Whether two names refer to the same person: identical, or one is a leading
 * token-prefix of the other ("Alessandro" ⊂ "Alessandro Viglione").
 */
const samePerson = (a: string, b: string): boolean => {
  const ta = normalize(a).split(' ')
  const tb = normalize(b).split(' ')
  const shorter = ta.length <= tb.length ? ta : tb
  const longer = ta.length <= tb.length ? tb : ta
  return shorter.every((token, i) => token === longer[i])
}

/**
 * Apply the verified names, merging every cluster that resolves to the same
 * person and remapping the segments onto the surviving speaker ids.
 */
export const applySpeakerNames = (
  speakers: Speaker[],
  segments: TranscriptionSegment[],
  mappings: SpeakerNameMapping[]
): SpeakerResolutionResult => {
  const nameByLabel = new Map(mappings.map((m) => [m.tag, m.name]))

  // Group speakers by resolved person; unnamed clusters stay on their own.
  const groups: Array<{ names: string[]; members: Speaker[] }> = []
  for (const speaker of speakers) {
    const name = nameByLabel.get(speaker.label)
    if (!name) {
      groups.push({ names: [], members: [speaker] })
      continue
    }
    const existing = groups.find((g) => g.names.some((n) => samePerson(n, name)))
    if (existing) {
      existing.names.push(name)
      existing.members.push(speaker)
    } else {
      groups.push({ names: [name], members: [speaker] })
    }
  }

  const idRemap = new Map<string, string>()
  const resolved: Speaker[] = []
  let genericIndex = 0

  for (const group of groups) {
    // The longest-speaking member keeps its id, so the dominant cluster wins.
    const canonical = group.members.reduce((best, member) =>
      member.totalSpeakingTime > best.totalSpeakingTime ? member : best
    )
    const totalSpeakingTime = group.members.reduce((sum, m) => sum + m.totalSpeakingTime, 0)

    let label: string
    if (group.names.length > 0) {
      label = canonicalName(group.names)
    } else if (/^Speaker \d+$/.test(canonical.label)) {
      // Renumber the leftover clusters so the user never sees "Speaker 17" in a
      // meeting that ended up with four speakers.
      genericIndex += 1
      label = `Speaker ${genericIndex}`
    } else {
      label = canonical.label
    }

    for (const member of group.members) idRemap.set(member.id, canonical.id)
    resolved.push({ id: canonical.id, label, totalSpeakingTime })
  }

  const remappedSegments = segments.map((segment) => {
    const speakerId = idRemap.get(segment.speakerId) ?? segment.speakerId
    return speakerId === segment.speakerId ? segment : { ...segment, speakerId }
  })

  const changed =
    mappings.length > 0 ||
    resolved.length !== speakers.length ||
    resolved.some((s, i) => s.label !== speakers[i]?.label)

  return { speakers: resolved, segments: remappedSegments, changed }
}
