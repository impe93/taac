import { app } from 'electron'
import { promises as fs } from 'fs'
import { dirname, join } from 'path'
import type { CalendarSpaceData } from './types'

/**
 * Single reader/writer for the per-space calendar file:
 *   {userData}/spaces/{spaceId}/config/calendar.json
 * (The per-space `config/` directory is created by FileSystemManager but was
 * otherwise unused.) Holds linked-account metadata + encrypted tokens + the
 * event→note link map + notified-event dedup keys.
 */

function spaceCalendarPath(spaceId: string): string {
  return join(app.getPath('userData'), 'spaces', spaceId, 'config', 'calendar.json')
}

function emptyData(): CalendarSpaceData {
  return { accounts: [], eventNoteLinks: {}, firedEventIds: [] }
}

export async function readSpaceCalendarData(spaceId: string): Promise<CalendarSpaceData> {
  try {
    const raw = await fs.readFile(spaceCalendarPath(spaceId), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<CalendarSpaceData>
    return {
      accounts: parsed.accounts ?? [],
      eventNoteLinks: parsed.eventNoteLinks ?? {},
      firedEventIds: parsed.firedEventIds ?? []
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyData()
    throw error
  }
}

export async function writeSpaceCalendarData(
  spaceId: string,
  data: CalendarSpaceData
): Promise<void> {
  const filePath = spaceCalendarPath(spaceId)
  await fs.mkdir(dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
}
