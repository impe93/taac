import { type FC } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useAppDispatch, useAppSelector } from '@renderer/store/hooks'
import { selectNoteById, openTab, selectSelectedNote } from '@renderer/store/slices/notesTreeSlice'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { FileText, Mic } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { NoteContextMenu } from './NoteContextMenu'
import { DropIndicator } from './DropIndicator'
import { useDndState } from '@renderer/components/dnd/DndProvider'
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
  const { dropIndicator } = useDndState()

  // HOOKS MUST BE CALLED BEFORE ANY CONDITIONAL RETURNS
  // Setup sortable (draggable + droppable for reordering)
  const dndId = `note-${noteId}`
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: dndId,
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
    dispatch(openTab({ noteId, folderId }))
    navigate({ to: '/note/$noteId', params: { noteId } })
  }

  const paddingLeft = level * 12 + 32

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    paddingLeft: `${paddingLeft}px`
  }

  const showTop = dropIndicator?.overId === dndId && dropIndicator.zone === 'before'
  const showBottom = dropIndicator?.overId === dndId && dropIndicator.zone === 'after'

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
          'relative w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors min-w-0',
          isSelected
            ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-full before:bg-primary before:content-['']"
            : 'hover:bg-sidebar-accent/60'
        )}
      >
        {showTop && <DropIndicator position="top" />}
        {showBottom && <DropIndicator position="bottom" />}
        {note.type === 'meeting' ? (
          <Mic
            className={cn('size-4 shrink-0', isSelected ? 'text-primary' : 'text-muted-foreground')}
          />
        ) : (
          <FileText
            className={cn('size-4 shrink-0', isSelected ? 'text-primary' : 'text-muted-foreground')}
          />
        )}
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
