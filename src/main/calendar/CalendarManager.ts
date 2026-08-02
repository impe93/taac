import { BrowserWindow } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import { configStore } from '../utils/configStore'
import { readSpaceCalendarData, writeSpaceCalendarData } from './accountStore'
import { showMeetingStartNotification } from './notifications'
import { GoogleCalendarProvider } from './providers/GoogleCalendarProvider'
import { MicrosoftCalendarProvider } from './providers/MicrosoftCalendarProvider'
import type { CalendarProvider } from './providers/types'
import { decryptTokens, encryptTokens, isSecureStorageAvailable } from './tokenStore'
import type {
  CalendarAccountSummary,
  CalendarProviderId,
  StoredAccount,
  UpcomingMeeting
} from './types'

export interface CalendarManagerDeps {
  getSpaces: () => Promise<Array<{ id: string }>>
  getMainWindow: () => BrowserWindow | null
}

/** Fire a notification for an event that already started, up to this late. */
const START_GRACE_MS = 2 * 60_000
const MAX_FIRED_KEYS = 300

/**
 * Owns calendar sync (bounded polling), per-event notification timers, and the
 * link between calendar accounts and spaces. Singleton, mirroring AudioManager.
 * Lifecycle patterns follow the RAG batch scheduler (config-driven interval,
 * overlap guard, explicit dispose).
 */
export class CalendarManager {
  private static instance: CalendarManager | null = null

  private deps: CalendarManagerDeps | null = null
  private initialized = false
  private polling = false

  private readonly providers: Record<CalendarProviderId, CalendarProvider> = {
    google: new GoogleCalendarProvider(),
    microsoft: new MicrosoftCalendarProvider()
  }

  private schedulerTimer: NodeJS.Timeout | null = null
  private configUnsub: (() => void) | null = null

  /** spaceId → upcoming meetings (sorted by start). */
  private readonly cache = new Map<string, UpcomingMeeting[]>()
  /** `${spaceId}::${eventKey}` → armed setTimeout handle. */
  private readonly eventTimers = new Map<string, NodeJS.Timeout>()
  /** `${spaceId}::${eventKey}` fired this session (dedup on top of persisted). */
  private readonly firedInMemory = new Set<string>()

  private constructor() {
    // Singleton — use getInstance().
  }

  static getInstance(): CalendarManager {
    if (!CalendarManager.instance) CalendarManager.instance = new CalendarManager()
    return CalendarManager.instance
  }

  // ---- lifecycle ----

  async initialize(deps: CalendarManagerDeps): Promise<void> {
    if (this.initialized) return
    this.deps = deps
    this.initialized = true
    this.restartScheduler()
    this.configUnsub = configStore.onDidChange('calendar', () => this.restartScheduler())
    void this.pollAll()
    console.log('[CalendarManager] Initialized')
  }

  dispose(): void {
    if (this.schedulerTimer) clearInterval(this.schedulerTimer)
    this.schedulerTimer = null
    this.configUnsub?.()
    this.configUnsub = null
    for (const timer of this.eventTimers.values()) clearTimeout(timer)
    this.eventTimers.clear()
    this.cache.clear()
    this.firedInMemory.clear()
    this.initialized = false
    console.log('[CalendarManager] Disposed')
  }

  private restartScheduler(): void {
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer)
      this.schedulerTimer = null
    }
    const minutes = configStore.get('calendar').syncIntervalMinutes
    if (!minutes || minutes <= 0) {
      console.log('[CalendarManager] Sync off')
      return
    }
    this.schedulerTimer = setInterval(() => void this.pollAll(), minutes * 60_000)
    this.schedulerTimer.unref?.()
    console.log(`[CalendarManager] Sync every ${minutes} min`)
  }

  private async pollAll(): Promise<void> {
    if (this.polling || !this.deps) return
    this.polling = true
    try {
      const spaces = await this.deps.getSpaces()
      for (const space of spaces) {
        try {
          await this.syncSpace(space.id)
        } catch (error) {
          console.warn(`[CalendarManager] Sync failed for space ${space.id}:`, error)
        }
      }
    } finally {
      this.polling = false
    }
  }

  // ---- public API (used by IPC handlers) ----

  isProviderConfigured(provider: CalendarProviderId): boolean {
    return this.providers[provider].isConfigured
  }

  configuredProviders(): CalendarProviderId[] {
    return (Object.keys(this.providers) as CalendarProviderId[]).filter(
      (id) => this.providers[id].isConfigured
    )
  }

  async listAccounts(spaceId: string): Promise<CalendarAccountSummary[]> {
    const data = await readSpaceCalendarData(spaceId)
    return data.accounts.map(toSummary)
  }

  async linkAccount(
    spaceId: string,
    provider: CalendarProviderId
  ): Promise<CalendarAccountSummary> {
    const impl = this.providers[provider]
    if (!impl.isConfigured) {
      throw new Error(`${provider} calendar is not configured (missing OAuth client ID).`)
    }
    if (!isSecureStorageAvailable()) {
      throw new Error('Secure storage is unavailable; calendar credentials cannot be stored.')
    }

    const { tokens, email, displayName } = await impl.authorize()
    const calendars = await impl.listCalendars(tokens)

    const data = await readSpaceCalendarData(spaceId)
    const existing = data.accounts.find((a) => a.provider === provider && a.email === email)

    const stored: StoredAccount = {
      id: existing?.id ?? uuidv4(),
      provider,
      email,
      displayName,
      addedAt: existing?.addedAt ?? new Date().toISOString(),
      encryptedTokens: encryptTokens(tokens),
      calendars: calendars.map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        primary: c.primary,
        // Enable only the primary calendar by default to avoid over-notifying.
        enabled: existing?.calendars.find((e) => e.id === c.id)?.enabled ?? Boolean(c.primary)
      }))
    }

    data.accounts = existing
      ? data.accounts.map((a) => (a.id === stored.id ? stored : a))
      : [...data.accounts, stored]
    await writeSpaceCalendarData(spaceId, data)

    this.broadcast('calendar:accounts-changed', { spaceId })
    void this.syncSpace(spaceId)
    return toSummary(stored)
  }

  async unlinkAccount(spaceId: string, accountId: string): Promise<void> {
    const data = await readSpaceCalendarData(spaceId)
    data.accounts = data.accounts.filter((a) => a.id !== accountId)
    await writeSpaceCalendarData(spaceId, data)
    this.broadcast('calendar:accounts-changed', { spaceId })
    void this.syncSpace(spaceId)
  }

  async setCalendarEnabled(
    spaceId: string,
    accountId: string,
    calendarId: string,
    enabled: boolean
  ): Promise<void> {
    const data = await readSpaceCalendarData(spaceId)
    const account = data.accounts.find((a) => a.id === accountId)
    if (!account) throw new Error('Account not found')
    const calendar = account.calendars.find((c) => c.id === calendarId)
    if (!calendar) throw new Error('Calendar not found')
    calendar.enabled = enabled
    await writeSpaceCalendarData(spaceId, data)
    this.broadcast('calendar:accounts-changed', { spaceId })
    void this.syncSpace(spaceId)
  }

  async syncNow(spaceId: string): Promise<void> {
    await this.syncSpace(spaceId)
  }

  async listUpcoming(spaceId: string, withinHours: number): Promise<UpcomingMeeting[]> {
    let list = this.cache.get(spaceId)
    if (!list) {
      await this.syncSpace(spaceId)
      list = this.cache.get(spaceId) ?? []
    }
    const now = Date.now()
    const cutoff = now + withinHours * 3_600_000
    return list.filter((m) => {
      const start = new Date(m.start).getTime()
      const end = new Date(m.end).getTime()
      return end >= now && start <= cutoff
    })
  }

  /** Persist the event→note link so the UI can show "note ready" and open it. */
  async linkNote(spaceId: string, eventId: string, noteId: string): Promise<void> {
    const data = await readSpaceCalendarData(spaceId)
    data.eventNoteLinks[eventId] = noteId
    await writeSpaceCalendarData(spaceId, data)
    const list = this.cache.get(spaceId)
    if (list) {
      for (const m of list) if (m.eventId === eventId) m.linkedNoteId = noteId
    }
    this.broadcast('calendar:upcoming-changed', { spaceId })
  }

  // ---- sync + notifications ----

  private async syncSpace(spaceId: string): Promise<void> {
    const data = await readSpaceCalendarData(spaceId)
    if (data.accounts.length === 0) {
      this.cache.set(spaceId, [])
      this.clearSpaceTimers(spaceId)
      this.broadcast('calendar:upcoming-changed', { spaceId })
      return
    }

    const windowHours = configStore.get('calendar').upcomingWindowHours
    const meetings: UpcomingMeeting[] = []
    let mutated = false

    for (const account of data.accounts) {
      const provider = this.providers[account.provider]
      if (!provider.isConfigured) continue

      let tokens
      try {
        tokens = decryptTokens(account.encryptedTokens)
      } catch (error) {
        console.warn(`[CalendarManager] Cannot decrypt tokens for ${account.email}:`, error)
        continue
      }

      let fresh
      try {
        fresh = await provider.ensureFreshTokens(tokens)
      } catch (error) {
        console.warn(`[CalendarManager] Token refresh failed for ${account.email}:`, error)
        continue
      }
      if (fresh.accessToken !== tokens.accessToken || fresh.expiresAt !== tokens.expiresAt) {
        account.encryptedTokens = encryptTokens(fresh)
        mutated = true
      }

      for (const calendar of account.calendars) {
        if (!calendar.enabled) continue
        try {
          const { events } = await provider.syncEvents({
            tokens: fresh,
            calendarId: calendar.id,
            windowHours
          })
          for (const event of events) {
            if (event.cancelled) continue
            meetings.push({
              spaceId,
              provider: account.provider,
              accountId: account.id,
              calendarId: calendar.id,
              eventId: event.id,
              title: event.title,
              start: event.start,
              end: event.end,
              htmlLink: event.htmlLink,
              location: event.location,
              organizer: event.organizer,
              joinUrl: event.joinUrl,
              linkedNoteId: data.eventNoteLinks[event.id]
            })
          }
        } catch (error) {
          console.warn(
            `[CalendarManager] Event sync failed (${account.email} / ${calendar.name}):`,
            error
          )
        }
      }
    }

    if (mutated) await writeSpaceCalendarData(spaceId, data)

    meetings.sort((a, b) => a.start.localeCompare(b.start))
    this.cache.set(spaceId, meetings)
    this.clearSpaceTimers(spaceId)
    this.armSpaceTimers(spaceId, meetings, data.firedEventIds)
    this.broadcast('calendar:upcoming-changed', { spaceId })
  }

  private armSpaceTimers(
    spaceId: string,
    meetings: UpcomingMeeting[],
    firedEventKeys: string[]
  ): void {
    const cfg = configStore.get('calendar')
    if (!cfg.notificationsEnabled) return

    const now = Date.now()
    const maxArmMs = cfg.upcomingWindowHours * 3_600_000

    for (const meeting of meetings) {
      const key = eventKey(meeting)
      const memKey = `${spaceId}::${key}`
      // Already notified (persisted or this session), or already turned into a note.
      if (firedEventKeys.includes(key) || this.firedInMemory.has(memKey)) continue
      if (meeting.linkedNoteId) continue

      const fireAt = new Date(meeting.start).getTime() - cfg.notificationLeadSeconds * 1000
      const delay = fireAt - now

      if (delay <= 0) {
        if (now - fireAt <= START_GRACE_MS) void this.fireMeeting(spaceId, meeting)
      } else if (delay <= maxArmMs) {
        const timer = setTimeout(() => void this.fireMeeting(spaceId, meeting), delay)
        timer.unref?.()
        this.eventTimers.set(memKey, timer)
      }
    }
  }

  private async fireMeeting(spaceId: string, meeting: UpcomingMeeting): Promise<void> {
    const key = eventKey(meeting)
    const memKey = `${spaceId}::${key}`
    if (this.firedInMemory.has(memKey)) return
    this.firedInMemory.add(memKey)
    this.eventTimers.delete(memKey)

    try {
      const data = await readSpaceCalendarData(spaceId)
      if (!data.firedEventIds.includes(key)) {
        data.firedEventIds.push(key)
        if (data.firedEventIds.length > MAX_FIRED_KEYS) {
          data.firedEventIds = data.firedEventIds.slice(-MAX_FIRED_KEYS)
        }
        await writeSpaceCalendarData(spaceId, data)
      }
    } catch (error) {
      console.warn('[CalendarManager] Failed to persist fired event:', error)
    }

    if (!configStore.get('calendar').notificationsEnabled) return
    showMeetingStartNotification(meeting, () => this.triggerMeeting(spaceId, meeting))
  }

  private triggerMeeting(spaceId: string, meeting: UpcomingMeeting): void {
    const win = this.deps?.getMainWindow() ?? null
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
    this.broadcast('calendar:trigger-meeting', { spaceId, meeting })
  }

  private clearSpaceTimers(spaceId: string): void {
    const prefix = `${spaceId}::`
    for (const [key, timer] of this.eventTimers) {
      if (key.startsWith(prefix)) {
        clearTimeout(timer)
        this.eventTimers.delete(key)
      }
    }
  }

  private broadcast(channel: string, payload: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.webContents.isDestroyed()) win.webContents.send(channel, payload)
    }
  }
}

function eventKey(meeting: Pick<UpcomingMeeting, 'accountId' | 'calendarId' | 'eventId'>): string {
  return `${meeting.accountId}:${meeting.calendarId}:${meeting.eventId}`
}

function toSummary(account: StoredAccount): CalendarAccountSummary {
  return {
    id: account.id,
    provider: account.provider,
    email: account.email,
    displayName: account.displayName,
    addedAt: account.addedAt,
    calendars: account.calendars
  }
}
