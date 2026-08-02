import type { CalendarProviderId, OAuthTokens, ProviderCalendar, SyncResult } from '../types'

export interface AuthorizeResult {
  tokens: OAuthTokens
  email: string
  displayName?: string
}

/**
 * A calendar provider. Implementations are pure-Node (main process). Adding
 * Apple later = a new implementation of this interface (auth via CalDAV +
 * app-specific password instead of OAuth); nothing else changes.
 */
export interface CalendarProvider {
  readonly id: CalendarProviderId
  /** False when the build lacks this provider's client ID → gated off in the UI. */
  readonly isConfigured: boolean
  /** Interactive linking: opens the browser, returns tokens + account identity. */
  authorize(): Promise<AuthorizeResult>
  /** Refresh the access token if it is expired/near-expiry; returns fresh tokens. */
  ensureFreshTokens(tokens: OAuthTokens): Promise<OAuthTokens>
  listCalendars(tokens: OAuthTokens): Promise<ProviderCalendar[]>
  /** Bounded query for events in [now, now + windowHours]. */
  syncEvents(args: {
    tokens: OAuthTokens
    calendarId: string
    windowHours: number
  }): Promise<SyncResult>
}
