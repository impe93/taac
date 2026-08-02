import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { CalendarManager } from '../calendar/CalendarManager'
import type { CalendarProviderId } from '../calendar/types'

/**
 * IPC surface for the calendar subsystem. Follows the standard pattern: colon
 * namespace, try/catch → contextual re-throw, lazy singleton access. Tokens/
 * secrets never cross this boundary — only account summaries and normalized
 * meetings are returned.
 */
export function registerCalendarHandlers(): void {
  const manager = (): CalendarManager => CalendarManager.getInstance()

  ipcMain.handle('calendar:configuredProviders', async (_event: IpcMainInvokeEvent) => {
    try {
      return manager().configuredProviders()
    } catch (error) {
      throw new Error(`Failed to list calendar providers: ${(error as Error).message}`)
    }
  })

  ipcMain.handle('calendar:listAccounts', async (_event: IpcMainInvokeEvent, spaceId: string) => {
    try {
      return await manager().listAccounts(spaceId)
    } catch (error) {
      throw new Error(`Failed to list calendar accounts: ${(error as Error).message}`)
    }
  })

  ipcMain.handle(
    'calendar:linkAccount',
    async (_event: IpcMainInvokeEvent, spaceId: string, provider: CalendarProviderId) => {
      try {
        return await manager().linkAccount(spaceId, provider)
      } catch (error) {
        throw new Error(`Failed to link calendar account: ${(error as Error).message}`)
      }
    }
  )

  ipcMain.handle(
    'calendar:unlinkAccount',
    async (_event: IpcMainInvokeEvent, spaceId: string, accountId: string) => {
      try {
        await manager().unlinkAccount(spaceId, accountId)
      } catch (error) {
        throw new Error(`Failed to unlink calendar account: ${(error as Error).message}`)
      }
    }
  )

  ipcMain.handle(
    'calendar:setCalendarEnabled',
    async (
      _event: IpcMainInvokeEvent,
      spaceId: string,
      accountId: string,
      calendarId: string,
      enabled: boolean
    ) => {
      try {
        await manager().setCalendarEnabled(spaceId, accountId, calendarId, enabled)
      } catch (error) {
        throw new Error(`Failed to update calendar: ${(error as Error).message}`)
      }
    }
  )

  ipcMain.handle('calendar:syncNow', async (_event: IpcMainInvokeEvent, spaceId: string) => {
    try {
      await manager().syncNow(spaceId)
    } catch (error) {
      throw new Error(`Failed to sync calendars: ${(error as Error).message}`)
    }
  })

  ipcMain.handle(
    'calendar:listUpcoming',
    async (_event: IpcMainInvokeEvent, spaceId: string, withinHours: number) => {
      try {
        return await manager().listUpcoming(spaceId, withinHours)
      } catch (error) {
        throw new Error(`Failed to list upcoming meetings: ${(error as Error).message}`)
      }
    }
  )

  ipcMain.handle(
    'calendar:linkNote',
    async (_event: IpcMainInvokeEvent, spaceId: string, eventId: string, noteId: string) => {
      try {
        await manager().linkNote(spaceId, eventId, noteId)
      } catch (error) {
        throw new Error(`Failed to link note to event: ${(error as Error).message}`)
      }
    }
  )
}
