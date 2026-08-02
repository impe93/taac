import { useMemo, useState, type ReactElement } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { format, isSameDay, parseISO } from 'date-fns'
import { Calendar, Clock, ExternalLink, MapPin, RefreshCw, Video } from 'lucide-react'
import type { UpcomingMeeting } from '@preload/types'
import { useActiveSpace } from '@renderer/hooks/useSpaces'
import { useConfig } from '@renderer/hooks/useConfig'
import { useSyncCalendars, useUpcomingMeetings } from '@renderer/hooks/useCalendar'
import { useStartMeetingFromEvent } from '@renderer/hooks/useStartMeetingFromEvent'
import { CalendarSettingsDialog } from '@renderer/components/calendar/CalendarSettingsDialog'
import { Button } from '@renderer/components/ui/button'
import { Badge } from '@renderer/components/ui/badge'

export const Route = createFileRoute('/calendar/')({
  component: CalendarPage
})

function CalendarPage(): ReactElement {
  const activeSpace = useActiveSpace()
  const spaceId = activeSpace?.id ?? null
  const { data: calendarCfg } = useConfig('calendar')
  const windowHours = calendarCfg?.upcomingWindowHours ?? 24

  const { data: meetings = [], isLoading } = useUpcomingMeetings(spaceId, windowHours)
  const syncNow = useSyncCalendars(spaceId ?? '')
  const startMeeting = useStartMeetingFromEvent()
  const [settingsOpen, setSettingsOpen] = useState(false)

  const groups = useMemo(() => groupByDay(meetings), [meetings])

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Calendar className="size-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Upcoming meetings</h1>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={!spaceId || syncNow.isPending}
            onClick={() => syncNow.mutate()}
          >
            <RefreshCw className={syncNow.isPending ? 'size-4 animate-spin' : 'size-4'} />
            Sync
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!spaceId}
            onClick={() => setSettingsOpen(true)}
          >
            Manage calendars
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : meetings.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No upcoming meetings in the next {windowHours}h.
          </p>
          <Button
            variant="link"
            size="sm"
            disabled={!spaceId}
            onClick={() => setSettingsOpen(true)}
          >
            Connect a calendar
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <div key={group.key}>
              <h2 className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                {group.label}
              </h2>
              <div className="flex flex-col gap-2">
                {group.meetings.map((meeting) => (
                  <MeetingRow
                    key={`${meeting.accountId}:${meeting.calendarId}:${meeting.eventId}`}
                    meeting={meeting}
                    onStart={() => startMeeting(meeting, { autoStart: !meeting.linkedNoteId })}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {spaceId && activeSpace ? (
        <CalendarSettingsDialog
          spaceId={spaceId}
          spaceName={activeSpace.name}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
        />
      ) : null}
    </div>
  )
}

function MeetingRow({
  meeting,
  onStart
}: {
  meeting: UpcomingMeeting
  onStart: () => void
}): ReactElement {
  const start = parseISO(meeting.start)
  const end = parseISO(meeting.end)
  const hasNote = Boolean(meeting.linkedNoteId)

  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      <div className="w-16 shrink-0 text-sm">
        <div className="font-medium">{format(start, 'HH:mm')}</div>
        <div className="text-xs text-muted-foreground">{format(end, 'HH:mm')}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{meeting.title}</div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3" />
            {format(start, 'EEE, MMM d')}
          </span>
          {meeting.location ? (
            <span className="inline-flex items-center gap-1 truncate">
              <MapPin className="size-3" />
              {meeting.location}
            </span>
          ) : null}
          {meeting.joinUrl ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 hover:text-foreground"
              onClick={() => window.open(meeting.joinUrl, '_blank')}
            >
              <Video className="size-3" />
              Join
            </button>
          ) : null}
          {meeting.htmlLink ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 hover:text-foreground"
              onClick={() => window.open(meeting.htmlLink, '_blank')}
            >
              <ExternalLink className="size-3" />
              Event
            </button>
          ) : null}
        </div>
      </div>
      <div className="shrink-0">
        {hasNote ? (
          <div className="flex items-center gap-2">
            <Badge variant="secondary">Note ready</Badge>
            <Button size="sm" variant="outline" onClick={onStart}>
              Open
            </Button>
          </div>
        ) : (
          <Button size="sm" onClick={onStart}>
            Start meeting note
          </Button>
        )}
      </div>
    </div>
  )
}

interface DayGroup {
  key: string
  label: string
  meetings: UpcomingMeeting[]
}

function groupByDay(meetings: UpcomingMeeting[]): DayGroup[] {
  const groups: DayGroup[] = []
  const today = new Date()
  for (const meeting of meetings) {
    const start = parseISO(meeting.start)
    const key = format(start, 'yyyy-MM-dd')
    let group = groups.find((g) => g.key === key)
    if (!group) {
      const label = isSameDay(start, today) ? 'Today' : format(start, 'EEEE, MMMM d')
      group = { key, label, meetings: [] }
      groups.push(group)
    }
    group.meetings.push(meeting)
  }
  return groups
}
