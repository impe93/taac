import { type ReactElement, useState, useCallback, useEffect, useMemo } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useAppSelector, useAppDispatch } from '@renderer/store/hooks'
import {
  selectNoteById,
  updateNote,
  selectActiveSpaceId
} from '@renderer/store/slices/notesTreeSlice'
import { MDXNoteEditor } from '@renderer/components/editor/MDXNoteEditor'
import { RawMarkdownEditor } from '@renderer/components/editor/RawMarkdownEditor'
import { NoteTitle } from '@renderer/components/editor/NoteTitle'
import { useAutoSave } from '@renderer/hooks/useAutoSave'
import { useEditorMode } from '@renderer/hooks/useEditorMode'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent } from '@renderer/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { Code, Eye } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { toast } from 'sonner'
import { MeetingRecorder } from '@renderer/components/meeting/MeetingRecorder'
import { MeetingProgress } from '@renderer/components/meeting/MeetingProgress'
import { MeetingMetadataBar } from '@renderer/components/meeting/MeetingMetadataBar'
import { useMeetingLifecycle } from '@renderer/hooks/useMeetingLifecycle'

export const Route = createFileRoute('/note/$noteId')({
  component: NoteView
})

function NoteView(): ReactElement {
  const { noteId } = Route.useParams()
  const dispatch = useAppDispatch()
  const note = useAppSelector(selectNoteById(noteId))
  const activeSpaceId = useAppSelector(selectActiveSpaceId)
  const { processingQueue, activeProcessingJob, processingFailure, clearProcessingFailure } =
    useMeetingLifecycle()

  const [title, setTitle] = useState(note?.title ?? '')
  const [content, setContent] = useState(note?.content ?? '')
  const [isSaving, setIsSaving] = useState(false)

  const myProcessingJob = useMemo(
    () => (note ? processingQueue.find((j) => j.noteId === note.id) : undefined),
    [processingQueue, note]
  )
  const isActiveProcessingHere = note ? activeProcessingJob?.noteId === note.id : false
  const isHeadOfQueue = note ? processingQueue[0]?.noteId === note.id : false
  const inProcessingPipeline = myProcessingJob !== undefined
  const showProcessingUi =
    inProcessingPipeline &&
    (isActiveProcessingHere || (isHeadOfQueue && activeProcessingJob === null))
  const isQueuedProcessingHere = inProcessingPipeline && !showProcessingUi

  const queuePosition = useMemo(() => {
    if (!note || !myProcessingJob) return 0
    const i = processingQueue.findIndex((j) => j.noteId === note.id)
    return i >= 0 ? i + 1 : 0
  }, [note, myProcessingJob, processingQueue])

  useEffect(() => {
    if (note) {
      setTitle(note.title)
      setContent(typeof note.content === 'string' ? note.content : '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only re-sync on note ID change
  }, [note?.id])

  useEffect(() => {
    if (note?.type === 'meeting' && note.meetingMetadata) {
      setContent(typeof note.content === 'string' ? note.content : '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only refresh local body when metadata appears (post-processing), not on every content edit
  }, [note?.id, note?.type, note?.meetingMetadata])

  const handleSave = useCallback(async (): Promise<void> => {
    if (!note || !activeSpaceId) return

    setIsSaving(true)
    try {
      await dispatch(
        updateNote({
          spaceId: activeSpaceId,
          folderId: note.folderId,
          noteId: note.id,
          updates: { title, content }
        })
      ).unwrap()
    } catch (error) {
      console.error('Failed to save note:', error)
      toast.error('Failed to save note')
    } finally {
      setIsSaving(false)
    }
  }, [dispatch, note, activeSpaceId, title, content])

  const { triggerSave, saveNow } = useAutoSave({
    onSave: handleSave,
    delay: 1500,
    enabled: !!note && !!activeSpaceId
  })

  useEffect(() => {
    return (): void => {
      saveNow()
    }
  }, [saveNow])

  const handleTitleChange = useCallback(
    (newTitle: string): void => {
      setTitle(newTitle)
      triggerSave()
    },
    [triggerSave]
  )

  const handleContentChange = useCallback(
    (newContent: string): void => {
      setContent(newContent)
      triggerSave()
    },
    [triggerSave]
  )

  const { isSourceMode, toggle: toggleEditorMode } = useEditorMode()

  if (!note) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Note not found</p>
      </div>
    )
  }

  if (note.type === 'meeting' && !note.meetingMetadata) {
    if (processingFailure?.noteId === note.id) {
      return (
        <div className="flex flex-col h-full w-full max-w-4xl mx-auto">
          <div className="px-6 py-4 border-b border-border">
            <NoteTitle title={title} onChange={handleTitleChange} placeholder="Meeting Title" />
          </div>
          <div className="flex items-center justify-center flex-1 p-6">
            <Card className="w-full max-w-md">
              <CardContent className="pt-8 pb-8 px-8 flex flex-col items-center gap-4 text-center">
                <p className="text-base font-medium">Processing failed</p>
                <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2 w-full">
                  {processingFailure.message}
                </p>
                <p className="text-sm text-muted-foreground">
                  You can try recording again or check your meeting settings and models.
                </p>
                <Button type="button" onClick={clearProcessingFailure}>
                  Dismiss
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      )
    }

    if (showProcessingUi) {
      return (
        <div className="flex flex-col h-full w-full max-w-4xl mx-auto">
          <div className="px-6 py-4 border-b border-border">
            <NoteTitle title={title} onChange={handleTitleChange} placeholder="Meeting Title" />
          </div>
          <MeetingProgress noteId={note.id} />
        </div>
      )
    }

    if (isQueuedProcessingHere) {
      return (
        <div className="flex flex-col h-full w-full max-w-4xl mx-auto">
          <div className="px-6 py-4 border-b border-border">
            <NoteTitle title={title} onChange={handleTitleChange} placeholder="Meeting Title" />
          </div>
          <div className="flex items-center justify-center flex-1 p-6">
            <Card className="w-full max-w-md">
              <CardContent className="pt-8 pb-8 px-8 flex flex-col items-center gap-3 text-center">
                <p className="text-base font-medium">Processing queued</p>
                <p className="text-sm text-muted-foreground">
                  This meeting is waiting in the processing queue (position {queuePosition}). You
                  can browse other notes; progress appears in the sidebar when processing starts.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      )
    }

    return (
      <div className="flex flex-col h-full w-full max-w-4xl mx-auto">
        <div className="px-6 py-4 border-b border-border">
          <NoteTitle title={title} onChange={handleTitleChange} placeholder="Meeting Title" />
        </div>
        <MeetingRecorder noteId={note.id} spaceId={activeSpaceId ?? ''} folderId={note.folderId} />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full w-full max-w-4xl mx-auto">
      <div className="px-6 py-4 border-b border-border">
        <div className="flex items-start justify-between gap-4">
          <NoteTitle title={title} onChange={handleTitleChange} placeholder="Untitled" />
          <div className="flex items-center gap-2 shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={isSourceMode ? 'default' : 'ghost'}
                  size="icon"
                  className={cn('size-8', isSourceMode && 'bg-primary text-primary-foreground')}
                  onClick={toggleEditorMode}
                >
                  {isSourceMode ? <Eye className="size-4" /> : <Code className="size-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>{isSourceMode ? 'Editor WYSIWYG' : 'Editor Markdown'}</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {note.type === 'meeting' && note.meetingMetadata && (
          <div className="mt-2">
            <MeetingMetadataBar metadata={note.meetingMetadata} />
          </div>
        )}

        {note.type !== 'meeting' && (
          <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
            <span>Last updated: {new Date(note.updatedAt).toLocaleString()}</span>
            {isSaving && <span className="text-primary animate-pulse">Saving...</span>}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto p-6">
        {isSourceMode ? (
          <RawMarkdownEditor markdown={content} onChange={handleContentChange} />
        ) : (
          <MDXNoteEditor
            markdown={content}
            onChange={handleContentChange}
            spaceId={activeSpaceId}
          />
        )}
      </div>
    </div>
  )
}
