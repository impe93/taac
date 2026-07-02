/**
 * Language helpers for the meeting pipeline.
 *
 * Centralizes ISO 639-1 handling so transcription, summarization and the UI all
 * agree on how a spoken language is normalized, named and resolved. The previous
 * code scattered hardcoded `'en'` fallbacks across four files; the resolver here
 * replaces those with an explicit chain (detected → user default → app locale)
 * and only ever uses 'en' as an absolute last resort.
 */

/** Sentinel meaning "auto-detect the spoken language". */
export const AUTO_LANGUAGE = 'auto'

/** ISO 639-1 code → English display name (labels stay in English by project rule). */
const CODE_TO_NAME: Record<string, string> = {
  en: 'English',
  it: 'Italian',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
  nl: 'Dutch',
  ru: 'Russian',
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  ar: 'Arabic',
  hi: 'Hindi',
  pl: 'Polish',
  sv: 'Swedish',
  da: 'Danish',
  fi: 'Finnish',
  no: 'Norwegian',
  tr: 'Turkish',
  cs: 'Czech',
  ro: 'Romanian',
  hu: 'Hungarian',
  uk: 'Ukrainian',
  el: 'Greek',
  he: 'Hebrew',
  th: 'Thai',
  vi: 'Vietnamese',
  id: 'Indonesian',
  ca: 'Catalan',
  hr: 'Croatian',
  bg: 'Bulgarian',
  sk: 'Slovak',
  ms: 'Malay'
}

/** Reverse map (english name → code) to tolerate models that emit full names. */
const NAME_TO_CODE: Record<string, string> = Object.entries(CODE_TO_NAME).reduce(
  (acc, [code, name]) => {
    acc[name.toLowerCase()] = code
    return acc
  },
  {} as Record<string, string>
)

/**
 * Normalize a raw language value into a bare ISO 639-1 code, or '' when unknown.
 *
 * Handles: undefined/empty, the 'auto' sentinel, whisper token forms like
 * '<|it|>', region suffixes ('it-IT' → 'it'), and full English names ('Italian').
 */
export function normalizeLanguageCode(input?: string | null): string {
  if (!input) return ''
  let value = String(input).trim().toLowerCase()
  if (!value || value === AUTO_LANGUAGE) return ''

  // Strip whisper token wrappers: '<|it|>' → 'it'
  const tokenMatch = value.match(/^<\|([a-z]{2,3})\|>$/)
  if (tokenMatch) value = tokenMatch[1]

  // Full english name → code
  if (NAME_TO_CODE[value]) return NAME_TO_CODE[value]

  // Region suffix → base code ('it-it' → 'it')
  const base = value.split(/[-_]/)[0]
  if (base && CODE_TO_NAME[base]) return base

  // Bare known code
  if (CODE_TO_NAME[value]) return value

  return ''
}

/** Human-readable English name for a code, falling back to the code itself. */
export function getLanguageName(code: string): string {
  const normalized = normalizeLanguageCode(code)
  return CODE_TO_NAME[normalized] ?? (code || 'English')
}

/**
 * Resolve the final language for a meeting using an explicit fallback chain.
 * Never returns a blind 'en': 'en' is only the ultimate default when nothing
 * else is known.
 *
 * @param detected     Language detected from the audio (may be '' / unknown)
 * @param userDefault  User's configured default (may be 'auto' / '')
 * @param appLocale    App UI locale, e.g. from Electron `app.getLocale()`
 */
export function resolveMeetingLanguage(
  detected?: string | null,
  userDefault?: string | null,
  appLocale?: string | null
): string {
  return (
    normalizeLanguageCode(detected) ||
    normalizeLanguageCode(userDefault) ||
    normalizeLanguageCode(appLocale) ||
    'en'
  )
}
