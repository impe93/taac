import { getJson } from '../httpJson'
import { PkceProviderConfig, refreshAccessToken, runPkceLoopbackFlow } from '../oauth'
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from '../providerConfig'
import type { OAuthTokens, ProviderCalendar, SyncResult } from '../types'
import type { AuthorizeResult, CalendarProvider } from './types'

const TOKEN_REFRESH_SKEW_MS = 60_000

const CONFIG: PkceProviderConfig = {
  clientId: GOOGLE_CLIENT_ID,
  clientSecret: GOOGLE_CLIENT_SECRET,
  scopes: ['openid', 'email', 'https://www.googleapis.com/auth/calendar.readonly'],
  endpoints: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token'
  },
  // Google's loopback migration recommends 127.0.0.1 over localhost.
  redirectHost: '127.0.0.1',
  // offline + consent so we reliably receive a refresh token.
  extraAuthParams: { access_type: 'offline', prompt: 'consent' }
}

interface GoogleUserInfo {
  email?: string
  name?: string
}

interface GoogleCalendarListResponse {
  items?: Array<{
    id: string
    summary?: string
    summaryOverride?: string
    backgroundColor?: string
    primary?: boolean
  }>
}

interface GoogleEventsResponse {
  items?: Array<{
    id: string
    status?: string
    summary?: string
    htmlLink?: string
    location?: string
    hangoutLink?: string
    organizer?: { email?: string; displayName?: string }
    start?: { dateTime?: string; date?: string }
    end?: { dateTime?: string; date?: string }
    conferenceData?: {
      entryPoints?: Array<{ entryPointType?: string; uri?: string }>
    }
  }>
}

export class GoogleCalendarProvider implements CalendarProvider {
  readonly id = 'google' as const

  get isConfigured(): boolean {
    return CONFIG.clientId.length > 0
  }

  async authorize(): Promise<AuthorizeResult> {
    const tokens = await runPkceLoopbackFlow(CONFIG)
    const info = await getJson<GoogleUserInfo>(
      'https://openidconnect.googleapis.com/v1/userinfo',
      tokens.accessToken
    ).catch(() => ({}) as GoogleUserInfo)
    return {
      tokens,
      email: info.email ?? 'Google account',
      displayName: info.name
    }
  }

  async ensureFreshTokens(tokens: OAuthTokens): Promise<OAuthTokens> {
    if (Date.now() < tokens.expiresAt - TOKEN_REFRESH_SKEW_MS) return tokens
    if (!tokens.refreshToken) return tokens
    return refreshAccessToken(CONFIG, tokens.refreshToken)
  }

  async listCalendars(tokens: OAuthTokens): Promise<ProviderCalendar[]> {
    const data = await getJson<GoogleCalendarListResponse>(
      'https://www.googleapis.com/calendar/v3/users/me/calendarList',
      tokens.accessToken
    )
    return (data.items ?? []).map((c) => ({
      id: c.id,
      name: c.summaryOverride ?? c.summary ?? c.id,
      color: c.backgroundColor,
      primary: c.primary
    }))
  }

  async syncEvents(args: {
    tokens: OAuthTokens
    calendarId: string
    windowHours: number
  }): Promise<SyncResult> {
    const timeMin = new Date().toISOString()
    const timeMax = new Date(Date.now() + args.windowHours * 3_600_000).toISOString()
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(args.calendarId)}/events`
    )
    url.searchParams.set('timeMin', timeMin)
    url.searchParams.set('timeMax', timeMax)
    url.searchParams.set('singleEvents', 'true')
    url.searchParams.set('orderBy', 'startTime')
    url.searchParams.set('maxResults', '50')
    url.searchParams.set('showDeleted', 'false')

    const data = await getJson<GoogleEventsResponse>(url.toString(), args.tokens.accessToken)

    const events = (data.items ?? [])
      // Only timed events are meetings; skip all-day (date-only) entries.
      .filter((e) => e.start?.dateTime && e.end?.dateTime)
      .map((e) => {
        const video = e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')
        return {
          id: e.id,
          title: e.summary ?? 'Untitled event',
          start: new Date(e.start!.dateTime as string).toISOString(),
          end: new Date(e.end!.dateTime as string).toISOString(),
          htmlLink: e.htmlLink,
          location: e.location,
          organizer: e.organizer?.email,
          joinUrl: e.hangoutLink ?? video?.uri,
          cancelled: e.status === 'cancelled'
        }
      })

    return { events }
  }
}
