import { useEffect, useRef, type ReactElement } from 'react'
import type { UpcomingMeeting } from '@preload/types'
import { useStartMeetingFromEvent } from '@renderer/hooks/useStartMeetingFromEvent'

/**
 * Listens for the meeting-start notification (fired by the main process when a
 * calendar event begins) and runs the create-note-and-record flow. Renders
 * nothing; must live inside MeetingLifecycleProvider so it can start recording.
 */
export function CalendarMeetingTrigger(): ReactElement | null {
  const startMeeting = useStartMeetingFromEvent()
  // Keep the latest callback in a ref so the IPC subscription is set up once.
  const startMeetingRef = useRef(startMeeting)
  startMeetingRef.current = startMeeting

  useEffect(() => {
    return window.calendar.onTriggerMeeting((payload: { meeting: UpcomingMeeting }) => {
      void (async (): Promise<void> => {
        const autoStart = (await window.config.get('calendar')).autoStartRecording
        await startMeetingRef.current(payload.meeting, { autoStart })
      })()
    })
  }, [])

  return null
}
