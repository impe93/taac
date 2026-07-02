/**
 * Spoken-language options for meeting recording and post-hoc correction.
 * Kept in one place so the recorder and the metadata bar stay in sync.
 */
export interface MeetingLanguageOption {
  value: string
  label: string
}

/** 'auto' lets Whisper detect the language; the rest are ISO 639-1 codes. */
export const MEETING_LANGUAGE_OPTIONS: MeetingLanguageOption[] = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'en', label: 'English' },
  { value: 'it', label: 'Italian' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'nl', label: 'Dutch' },
  { value: 'ru', label: 'Russian' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'ar', label: 'Arabic' },
  { value: 'hi', label: 'Hindi' },
  { value: 'pl', label: 'Polish' }
]

/** Explicit languages only (no 'auto') — used when correcting a detected language. */
export const MEETING_LANGUAGE_CHOICES: MeetingLanguageOption[] = MEETING_LANGUAGE_OPTIONS.filter(
  (o) => o.value !== 'auto'
)

/** English display name for an ISO 639-1 code, falling back to Intl / the raw code. */
export function meetingLanguageLabel(code: string): string {
  const known = MEETING_LANGUAGE_OPTIONS.find((o) => o.value === code)
  if (known) return known.label
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code.toUpperCase()
  } catch {
    return code.toUpperCase()
  }
}
