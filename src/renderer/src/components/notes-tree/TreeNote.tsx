import { type FC } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useAppDispatch, useAppSelector } from '@renderer/store/hooks'
import {
  selectNoteById,
  selectNote,
  selectSelectedNote
} from '@renderer/store/slices/notesTreeSlice'
import { FileText } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { NoteContextMenu } from './NoteContextMenu'

interface TreeNoteProps {
  noteId: string
  folderId: string
  level: number
  onDelete: (noteId: string, noteName: string, folderId: string) => void
}

export const TreeNote: FC<TreeNoteProps> = ({ noteId, folderId, level, onDelete }) => {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const note = useAppSelector(selectNoteById(noteId))
  const { noteId: selectedNoteId } = useAppSelector(selectSelectedNote)

  if (!note) return null

  const isSelected = selectedNoteId === noteId

  const handleClick = (): void => {
    dispatch(selectNote({ noteId, folderId }))
    navigate({ to: '/note/$noteId', params: { noteId } })
  }

  const paddingLeft = level * 12 + 32

  return (
    <NoteContextMenu
      noteId={noteId}
      noteName={note.title || '(Untitled)'}
      folderId={folderId}
      onDelete={() => onDelete(noteId, note.title || '(Untitled)', folderId)}
    >
      <button
        onClick={handleClick}
        className={cn(
          'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors',
          isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
        )}
        style={{ paddingLeft: `${paddingLeft}px` }}
      >
        <FileText className="size-4 text-muted-foreground shrink-0" />
        <span className="flex-1 text-left truncate">{note.title || '(Untitled)'}</span>
      </button>
    </NoteContextMenu>
  )
}
