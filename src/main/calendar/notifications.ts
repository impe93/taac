import { Notification } from 'electron'
import type { UpcomingMeeting } from './types'

/**
 * Native "meeting starting" notification with an action button. On macOS the
 * action button appears for Alert-style notifications; we also handle plain
 * `click` as a fallback so the flow works regardless of notification style.
 */
export function showMeetingStartNotification(
  meeting: UpcomingMeeting,
  onTrigger: () => void
): void {
  if (!Notification.isSupported()) return

  const notification = new Notification({
    title: meeting.title || 'Meeting starting',
    body: 'Click to create a meeting note and start recording.',
    actions: [{ type: 'button', text: 'Start meeting note' }]
  })

  let handled = false
  const handle = (): void => {
    if (handled) return
    handled = true
    onTrigger()
  }

  notification.on('action', handle)
  notification.on('click', handle)
  notification.show()
}
