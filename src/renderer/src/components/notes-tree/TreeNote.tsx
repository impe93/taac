import { type FC } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useAppDispatch, useAppSelector } from '@renderer/store/hooks'
import {
  selectNoteById,
  selectNote,
  selectSelectedNote
} from '@renderer/store/slices/notesTreeSlice'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { FileText } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { NoteContextMenu } from './NoteContextMenu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'

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

  // HOOKS MUST BE CALLED BEFORE ANY CONDITIONAL RETURNS
  // Setup draggable
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `note-${noteId}`,
    data: {
      type: 'note',
      id: noteId,
      folderId: folderId,
      name: note?.title || '(Untitled)'
    }
  })

  // NOW we can do conditional returns
  if (!note) return null

  const isSelected = selectedNoteId === noteId

  const handleClick = (): void => {
    dispatch(selectNote({ noteId, folderId }))
    navigate({ to: '/note/$noteId', params: { noteId } })
  }

  const paddingLeft = level * 12 + 32

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
    paddingLeft: `${paddingLeft}px`
  }

  return (
    <NoteContextMenu
      noteId={noteId}
      noteName={note.title || '(Untitled)'}
      folderId={folderId}
      onDelete={() => onDelete(noteId, note.title || '(Untitled)', folderId)}
    >
      <button
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        onClick={handleClick}
        className={cn(
          'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors min-w-0',
          isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
        )}
      >
        <FileText className="size-4 text-muted-foreground shrink-0" />
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex-1 text-left truncate min-w-0">{note.title || '(Untitled)'}</span>
          </TooltipTrigger>
          <TooltipContent side="right">{note.title || '(Untitled)'}</TooltipContent>
        </Tooltip>
      </button>
    </NoteContextMenu>
  )
}
