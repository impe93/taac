// Shared types for the calendar sync subsystem.
//
// Design notes:
// - We poll bounded time-windowed queries ([now, now + upcomingWindowHours]) on
//   every tick instead of provider incremental-sync tokens. The window is small
//   (default 24h) and the cadence low (default 5 min), so bounded queries are
//   simpler and lighter than maintaining a local event store + token/410 handling.
// - Tokens are encrypted at rest via Electron safeStorage and never leave main.

export type CalendarProviderId = 'google' | 'microsoft'

/** OAuth 2.0 tokens for a linked account. Persisted encrypted (see tokenStore). */
export interface OAuthTokens {
  accessToken: string
  refreshToken?: string
  /** Absolute expiry in epoch milliseconds. */
  expiresAt: number
  scope?: string
  tokenType?: string
  idToken?: string
}

/** A calendar discovered on a linked account. */
export interface ProviderCalendar {
  id: string
  name: string
  color?: string
  primary?: boolean
}

/** A normalized calendar event returned by a provider. */
export interface ProviderEvent {
  id: string
  title: string
  /** ISO 8601. */
  start: string
  /** ISO 8601. */
  end: string
  htmlLink?: string
  location?: string
  organizer?: string
  /** Video-call join URL (Meet / Teams / Zoom) when present. */
  joinUrl?: string
  cancelled?: boolean
}

export interface SyncResult {
  events: ProviderEvent[]
}

// ---- Persisted per-space (spaces/{spaceId}/config/calendar.json) ----

export interface StoredCalendar {
  id: string
  name: string
  enabled: boolean
  color?: string
  primary?: boolean
}

export interface StoredAccount {
  id: string
  provider: CalendarProviderId
  email: string
  displayName?: string
  addedAt: string
  /** safeStorage-encrypted OAuthTokens (base64). Never sent to the renderer. */
  encryptedTokens: string
  calendars: StoredCalendar[]
}

export interface CalendarSpaceData {
  accounts: StoredAccount[]
  /** eventId → noteId, so the UI can show "note ready" and open it. */
  eventNoteLinks: Record<string, string>
  /** Composite keys of events already notified, to avoid duplicate notifications. */
  firedEventIds: string[]
}

// ---- Renderer-facing shapes (never carry secrets) ----

export interface CalendarAccountSummary {
  id: string
  provider: CalendarProviderId
  email: string
  displayName?: string
  addedAt: string
  calendars: StoredCalendar[]
}

export interface UpcomingMeeting {
  spaceId: string
  provider: CalendarProviderId
  accountId: string
  calendarId: string
  eventId: string
  title: string
  start: string
  end: string
  htmlLink?: string
  location?: string
  organizer?: string
  joinUrl?: string
  linkedNoteId?: string
}
