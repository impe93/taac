import { type FC } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { cn } from '@renderer/lib/utils'
import { useDndState } from '@renderer/components/dnd/DndProvider'
import { ArrowUpToLine } from 'lucide-react'

export const RootDropZone: FC = () => {
  const { activeItem } = useDndState()

  const { setNodeRef, isOver } = useDroppable({
    id: 'folder-drop-root',
    data: {
      type: 'folder',
      folderId: 'root'
    }
  })

  // Only show during active drag, and only if item is not already at root
  if (!activeItem || activeItem.folderId === 'root') return null

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'mx-2 mt-1 flex items-center justify-center gap-2 rounded-md border-2 border-dashed px-3 py-2.5 transition-colors',
        isOver
          ? 'border-primary bg-primary/15 text-primary'
          : 'border-muted-foreground/30 text-muted-foreground'
      )}
    >
      <ArrowUpToLine className="size-4 shrink-0" />
      <span className="text-xs font-medium">Move to root level</span>
    </div>
  )
}
