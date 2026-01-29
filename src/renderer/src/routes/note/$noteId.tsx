import { type ReactElement, useState, useCallback, useEffect } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useAppSelector, useAppDispatch } from '@renderer/store/hooks'
import {
  selectNoteById,
  updateNote,
  selectActiveSpaceId
} from '@renderer/store/slices/notesTreeSlice'
import { MDXNoteEditor } from '@renderer/components/editor/MDXNoteEditor'
import { NoteTitle } from '@renderer/components/editor/NoteTitle'
import { useAutoSave } from '@renderer/hooks/useAutoSave'
import { toast } from 'sonner'

export const Route = createFileRoute('/note/$noteId')({
  component: NoteView
})

function NoteView(): ReactElement {
  const { noteId } = Route.useParams()
  const dispatch = useAppDispatch()
  const note = useAppSelector(selectNoteById(noteId))
  const activeSpaceId = useAppSelector(selectActiveSpaceId)

  // Local state for optimistic updates
  const [title, setTitle] = useState(note?.title ?? '')
  const [content, setContent] = useState(note?.content ?? '')
  const [isSaving, setIsSaving] = useState(false)

  // Sync local state when note changes (e.g., navigating to different note)
  useEffect(() => {
    if (note) {
      setTitle(note.title)
      // Ensure content is a string (for backward compatibility with old Lexical format)
      setContent(typeof note.content === 'string' ? note.content : '')
    }
  }, [note?.id]) // Only re-sync when noteId changes, not on every note update

  // Auto-save handler
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

  // Auto-save with 1.5s debounce
  const { triggerSave, saveNow } = useAutoSave({
    onSave: handleSave,
    delay: 1500,
    enabled: !!note && !!activeSpaceId
  })

  // Save on unmount
  useEffect(() => {
    return (): void => {
      saveNow()
    }
  }, [saveNow])

  // Handle title change
  const handleTitleChange = useCallback(
    (newTitle: string): void => {
      setTitle(newTitle)
      triggerSave()
    },
    [triggerSave]
  )

  // Handle content change
  const handleContentChange = useCallback(
    (newContent: string): void => {
      setContent(newContent)
      triggerSave()
    },
    [triggerSave]
  )

  // Loading/not found state
  if (!note) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Note not found</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full w-full max-w-4xl mx-auto">
      {/* Header with title */}
      <div className="px-6 py-4 border-b border-border">
        <NoteTitle title={title} onChange={handleTitleChange} placeholder="Untitled" />
        <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
          <span>Last updated: {new Date(note.updatedAt).toLocaleString()}</span>
          {isSaving && <span className="text-primary animate-pulse">Saving...</span>}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-auto p-6">
        <MDXNoteEditor markdown={content} onChange={handleContentChange} spaceId={activeSpaceId} />
      </div>
    </div>
  )
}
