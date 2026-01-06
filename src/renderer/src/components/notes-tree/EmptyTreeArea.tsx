import { type FC } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { cn } from '@renderer/lib/utils'
import { EmptySpaceContextMenu } from './EmptySpaceContextMenu'

interface EmptyTreeAreaProps {
  onCreateNote: () => void
  onCreateFolder: () => void
  children: React.ReactNode
}

export const EmptyTreeArea: FC<EmptyTreeAreaProps> = ({
  onCreateNote,
  onCreateFolder,
  children
}) => {
  // Setup droppable for root level
  const { setNodeRef, isOver } = useDroppable({
    id: 'folder-drop-root',
    data: {
      type: 'folder',
      folderId: 'root'
    }
  })

  return (
    <EmptySpaceContextMenu onCreateNote={onCreateNote} onCreateFolder={onCreateFolder}>
      <div
        ref={setNodeRef}
        className={cn(
          'min-h-[200px] w-full transition-colors',
          isOver && 'bg-accent/30 ring-2 ring-primary/30 rounded-md'
        )}
      >
        {children}
      </div>
    </EmptySpaceContextMenu>
  )
}
