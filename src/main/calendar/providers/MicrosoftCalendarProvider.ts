import { getJson } from '../httpJson'
import { PkceProviderConfig, refreshAccessToken, runPkceLoopbackFlow } from '../oauth'
import { MICROSOFT_CLIENT_ID, MICROSOFT_TENANT } from '../providerConfig'
import type { OAuthTokens, ProviderCalendar, SyncResult } from '../types'
import type { AuthorizeResult, CalendarProvider } from './types'

const TOKEN_REFRESH_SKEW_MS = 60_000
const GRAPH = 'https://graph.microsoft.com/v1.0'

const CONFIG: PkceProviderConfig = {
  clientId: MICROSOFT_CLIENT_ID,
  scopes: ['openid', 'profile', 'email', 'offline_access', 'Calendars.Read', 'User.Read'],
  endpoints: {
    authorizeUrl: `https://login.microsoftonline.com/${MICROSOFT_TENANT}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${MICROSOFT_TENANT}/oauth2/v2.0/token`
  },
  // Microsoft public-client loopback expects the localhost host.
  redirectHost: 'localhost',
  extraAuthParams: { prompt: 'select_account' }
}

interface GraphMe {
  mail?: string
  userPrincipalName?: string
  displayName?: string
}

interface GraphCalendarsResponse {
  value?: Array<{
    id: string
    name?: string
    color?: string
    isDefaultCalendar?: boolean
  }>
}

interface GraphEventsResponse {
  value?: Array<{
    id: string
    subject?: string
    isCancelled?: boolean
    webLink?: string
    onlineMeetingUrl?: string
    onlineMeeting?: { joinUrl?: string }
    location?: { displayName?: string }
    organizer?: { emailAddress?: { address?: string } }
    start?: { dateTime?: string; timeZone?: string }
    end?: { dateTime?: string; timeZone?: string }
  }>
}

/** Graph returns `dateTime` without a zone designator; with the UTC Prefer header it is UTC. */
function graphUtcToIso(dateTime: string | undefined): string | null {
  if (!dateTime) return null
  const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(dateTime) ? dateTime : `${dateTime}Z`
  const parsed = new Date(withZone)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

export class MicrosoftCalendarProvider implements CalendarProvider {
  readonly id = 'microsoft' as const

  get isConfigured(): boolean {
    return CONFIG.clientId.length > 0
  }

  async authorize(): Promise<AuthorizeResult> {
    const tokens = await runPkceLoopbackFlow(CONFIG)
    const me = await getJson<GraphMe>(`${GRAPH}/me`, tokens.accessToken).catch(
      () => ({}) as GraphMe
    )
    return {
      tokens,
      email: me.mail ?? me.userPrincipalName ?? 'Microsoft account',
      displayName: me.displayName
    }
  }

  async ensureFreshTokens(tokens: OAuthTokens): Promise<OAuthTokens> {
    if (Date.now() < tokens.expiresAt - TOKEN_REFRESH_SKEW_MS) return tokens
    if (!tokens.refreshToken) return tokens
    return refreshAccessToken(CONFIG, tokens.refreshToken)
  }

  async listCalendars(tokens: OAuthTokens): Promise<ProviderCalendar[]> {
    const data = await getJson<GraphCalendarsResponse>(`${GRAPH}/me/calendars`, tokens.accessToken)
    return (data.value ?? []).map((c) => ({
      id: c.id,
      name: c.name ?? c.id,
      color: c.color,
      primary: c.isDefaultCalendar
    }))
  }

  async syncEvents(args: {
    tokens: OAuthTokens
    calendarId: string
    windowHours: number
  }): Promise<SyncResult> {
    const start = new Date().toISOString()
    const end = new Date(Date.now() + args.windowHours * 3_600_000).toISOString()
    const url = new URL(`${GRAPH}/me/calendars/${encodeURIComponent(args.calendarId)}/calendarView`)
    url.searchParams.set('startDateTime', start)
    url.searchParams.set('endDateTime', end)
    url.searchParams.set('$orderby', 'start/dateTime')
    url.searchParams.set('$top', '50')

    const data = await getJson<GraphEventsResponse>(url.toString(), args.tokens.accessToken, {
      Prefer: 'outlook.timezone="UTC"'
    })

    const events = (data.value ?? [])
      .map((e) => {
        const startIso = graphUtcToIso(e.start?.dateTime)
        const endIso = graphUtcToIso(e.end?.dateTime)
        if (!startIso || !endIso) return null
        return {
          id: e.id,
          title: e.subject ?? 'Untitled event',
          start: startIso,
          end: endIso,
          htmlLink: e.webLink,
          location: e.location?.displayName,
          organizer: e.organizer?.emailAddress?.address,
          joinUrl: e.onlineMeeting?.joinUrl ?? e.onlineMeetingUrl,
          cancelled: e.isCancelled === true
        }
      })
      .filter((e): e is NonNullable<typeof e> => e !== null)

    return { events }
  }
}
