import { useCallback, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import type { CalendarLink, UpcomingMeeting } from '@preload/types'
import { useAppDispatch, useAppStore } from '@renderer/store/hooks'
import {
  createFolder,
  createNote,
  loadTree,
  selectActiveSpaceId,
  switchActiveSpace,
  updateNote
} from '@renderer/store/slices/notesTreeSlice'
import { EMPTY_EDITOR_STATE } from '@renderer/components/notes-tree/constants'
import { useMeetingLifecycle } from '@renderer/hooks/useMeetingLifecycle'

const MEETINGS_FOLDER_NAME = 'Meetings'

/**
 * Shared flow behind both the meeting-start notification and the "Start meeting
 * note" button in the Upcoming list: make the event's space active, find/create
 * its meeting note (linked to the event) in a "Meetings" folder, open it, and —
 * when requested — start recording (best-effort; see the recorder fallback).
 */
export function useStartMeetingFromEvent(): (
  meeting: UpcomingMeeting,
  opts?: { autoStart?: boolean }
) => Promise<void> {
  const dispatch = useAppDispatch()
  const store = useAppStore()
  const navigate = useNavigate()
  const { startRecording } = useMeetingLifecycle()
  const inFlight = useRef<Set<string>>(new Set())

  return useCallback(
    async (meeting: UpcomingMeeting, opts?: { autoStart?: boolean }): Promise<void> => {
      const dedupeKey = `${meeting.spaceId}:${meeting.eventId}`
      if (inFlight.current.has(dedupeKey)) return
      inFlight.current.add(dedupeKey)

      try {
        // 1. The note/folder selectors operate on the ACTIVE space — make it active.
        if (selectActiveSpaceId(store.getState()) !== meeting.spaceId) {
          await window.config.set('activeSpaceId', meeting.spaceId)
          dispatch(switchActiveSpace(meeting.spaceId))
        }
        if (!store.getState().notesTree.spaces[meeting.spaceId]?.isFullyHydrated) {
          await dispatch(loadTree({ spaceId: meeting.spaceId })).unwrap()
        }

        // 2. Resolve an existing note for this event, or create one.
        let noteId =
          meeting.linkedNoteId ?? findNoteIdForEvent(store, meeting.spaceId, meeting.eventId)
        let folderId: string

        if (noteId) {
          folderId =
            store.getState().notesTree.spaces[meeting.spaceId]?.notes[noteId]?.folderId ?? 'root'
        } else {
          folderId = await findOrCreateMeetingsFolder(store, dispatch, meeting.spaceId)
          const res = await dispatch(
            createNote({
              spaceId: meeting.spaceId,
              folderId,
              title: meeting.title || 'Meeting',
              content: EMPTY_EDITOR_STATE,
              type: 'meeting'
            })
          )
          if (!createNote.fulfilled.match(res)) {
            toast.error('Failed to create the meeting note')
            return
          }
          noteId = res.payload.note.id

          const calendarLink: CalendarLink = {
            provider: meeting.provider,
            accountId: meeting.accountId,
            calendarId: meeting.calendarId,
            eventId: meeting.eventId,
            title: meeting.title,
            start: meeting.start,
            end: meeting.end,
            htmlLink: meeting.htmlLink
          }
          await Promise.all([
            window.calendar.linkNote(meeting.spaceId, meeting.eventId, noteId).catch(() => {}),
            dispatch(
              updateNote({ spaceId: meeting.spaceId, folderId, noteId, updates: { calendarLink } })
            )
              .unwrap()
              .catch(() => {})
          ])
        }

        // 3. Open the note.
        navigate({ to: '/note/$noteId', params: { noteId } })

        // 4. Best-effort auto-start. If the recording mode needs system audio and
        //    there is no user gesture, startRecording surfaces the failure and the
        //    MeetingRecorder (already shown for a metadata-less meeting note) offers
        //    a one-click Start.
        if (opts?.autoStart) {
          const meetingCfg = await window.config.get('meeting')
          await startRecording({
            noteId,
            spaceId: meeting.spaceId,
            folderId,
            mode: meetingCfg.defaultRecordingMode,
            language: meetingCfg.defaultLanguage
          })
        }
      } catch (error) {
        toast.error((error as Error).message || 'Failed to start meeting note')
      } finally {
        inFlight.current.delete(dedupeKey)
      }
    },
    [dispatch, store, navigate, startRecording]
  )
}

type Store = ReturnType<typeof useAppStore>
type Dispatch = ReturnType<typeof useAppDispatch>

function findNoteIdForEvent(store: Store, spaceId: string, eventId: string): string | undefined {
  const space = store.getState().notesTree.spaces[spaceId]
  if (!space) return undefined
  for (const note of Object.values(space.notes)) {
    if (note.calendarLink?.eventId === eventId) return note.id
  }
  return undefined
}

async function findOrCreateMeetingsFolder(
  store: Store,
  dispatch: Dispatch,
  spaceId: string
): Promise<string> {
  const space = store.getState().notesTree.spaces[spaceId]
  const root = space?.folders['root']
  if (root && space) {
    for (const childId of root.children) {
      const folder = space.folders[childId]
      if (folder && folder.name === MEETINGS_FOLDER_NAME) return folder.id
    }
  }
  const res = await dispatch(
    createFolder({ spaceId, name: MEETINGS_FOLDER_NAME, parentId: 'root' })
  ).unwrap()
  return res.folder.id
}
