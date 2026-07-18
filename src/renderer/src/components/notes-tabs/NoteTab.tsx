import { type FC, type MouseEvent } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { FileText, Mic, X } from 'lucide-react'
import { useAppSelector } from '@renderer/store/hooks'
import { selectNoteById } from '@renderer/store/slices/notesTreeSlice'
import { cn } from '@renderer/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'

interface NoteTabProps {
  noteId: string
  isActive: boolean
  onFocus: (noteId: string) => void
  onClose: (noteId: string) => void
}

/**
 * Singola scheda nota: larghezza fissa, titolo con ellissi, icona di chiusura.
 * Draggable (riordino orizzontale) tramite @dnd-kit/sortable.
 */
export const NoteTab: FC<NoteTabProps> = ({ noteId, isActive, onFocus, onClose }) => {
  const note = useAppSelector(selectNoteById(noteId))
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: noteId
  })

  const title = note?.title || '(Untitled)'

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  }

  const handleClose = (e: MouseEvent): void => {
    e.stopPropagation()
    onClose(noteId)
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group relative flex w-40 shrink-0 items-center gap-1.5 rounded-t-md border-b-2 pl-3 pr-1 py-1.5 text-sm transition-colors',
        isActive
          ? 'bg-editor border-b-primary text-foreground'
          : 'border-b-transparent text-muted-foreground hover:bg-muted/60'
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        onClick={() => onFocus(noteId)}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
      >
        {note?.type === 'meeting' ? (
          <Mic
            className={cn('size-3.5 shrink-0', isActive ? 'text-primary' : 'text-muted-foreground')}
          />
        ) : (
          <FileText
            className={cn('size-3.5 shrink-0', isActive ? 'text-primary' : 'text-muted-foreground')}
          />
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="min-w-0 flex-1 truncate">{title}</span>
          </TooltipTrigger>
          <TooltipContent side="bottom">{title}</TooltipContent>
        </Tooltip>
      </button>
      <button
        type="button"
        aria-label="Close tab"
        onClick={handleClose}
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded hover:bg-muted-foreground/20',
          isActive
            ? 'opacity-70 hover:opacity-100'
            : 'opacity-0 group-hover:opacity-70 hover:opacity-100'
        )}
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}
