import { type FC, useEffect, useRef } from 'react'
import { useAppDispatch, useAppSelector } from '@renderer/store/hooks'
import {
  toggleFolder,
  selectFolder,
  selectOrderedItems,
  selectExpandedFolders,
  expandFolder
} from '@renderer/store/slices/notesTreeSlice'
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@renderer/components/ui/collapsible'
import { ChevronRight, Folder, FolderOpen } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { orderedItemDndId } from '@renderer/lib/treeOrder'
import { TreeNote } from './TreeNote'
import { DropIndicator } from './DropIndicator'
import { useDndState } from '@renderer/components/dnd/DndProvider'
import { FolderContextMenu } from './FolderContextMenu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'

interface TreeFolderProps {
  folderId: string
  level: number
  onCreateNote: (folderId: string) => void
  onCreateFolder: (folderId: string) => void
  onRenameFolder: (folderId: string, folderName: string) => void
  onDeleteFolder: (folderId: string, folderName: string) => void
  onDeleteNote: (noteId: string, noteName: string, folderId: string) => void
}

export const TreeFolder: FC<TreeFolderProps> = ({
  folderId,
  level,
  onCreateNote,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onDeleteNote
}) => {
  const dispatch = useAppDispatch()
  const folder = useAppSelector(selectFolder(folderId))
  const orderedItems = useAppSelector(selectOrderedItems(folderId))
  const expandedFolders = useAppSelector(selectExpandedFolders)
  const { dropIndicator } = useDndState()

  // HOOKS MUST BE CALLED BEFORE ANY CONDITIONAL RETURNS
  // Setup sortable (draggable + droppable for reordering/nesting)
  const dndId = `folder-${folderId}`
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: dndId,
    data: {
      type: 'folder',
      id: folderId,
      folderId: folder?.parentId || 'root',
      name: folder?.name || 'Unnamed Folder'
    }
  })

  const isInsideTarget = dropIndicator?.overId === dndId && dropIndicator.zone === 'inside'

  // Auto-expand on hover during drag when this folder is the nesting target
  const expandTimerRef = useRef<NodeJS.Timeout | null>(null)
  const isExpanded = expandedFolders.includes(folderId)

  useEffect(() => {
    if (isInsideTarget && !isExpanded) {
      expandTimerRef.current = setTimeout(() => {
        dispatch(expandFolder(folderId))
      }, 1500) // 1.5 second delay
    }

    return () => {
      if (expandTimerRef.current) {
        clearTimeout(expandTimerRef.current)
        expandTimerRef.current = null
      }
    }
  }, [isInsideTarget, isExpanded, folderId, dispatch])

  // NOW we can do conditional returns
  if (!folder) return null

  const handleToggle = (): void => {
    dispatch(toggleFolder(folderId))
  }

  const paddingLeft = level * 12

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  }

  const showTop = dropIndicator?.overId === dndId && dropIndicator.zone === 'before'
  const showBottom = dropIndicator?.overId === dndId && dropIndicator.zone === 'after'

  return (
    <Collapsible open={isExpanded} onOpenChange={handleToggle}>
      <div
        ref={setNodeRef}
        style={style}
        className={cn(
          'group relative',
          isInsideTarget && 'bg-accent/50 ring-2 ring-primary/50 rounded-md'
        )}
      >
        {showTop && <DropIndicator position="top" />}
        {showBottom && <DropIndicator position="bottom" />}
        <FolderContextMenu
          folderId={folderId}
          folderName={folder.name}
          onCreateNote={() => onCreateNote(folderId)}
          onCreateFolder={() => onCreateFolder(folderId)}
          onRename={() => onRenameFolder(folderId, folder.name)}
          onDelete={() => onDeleteFolder(folderId, folder.name)}
        >
          <CollapsibleTrigger asChild>
            <button
              {...attributes}
              {...listeners}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-sidebar-accent/60 text-sm transition-colors min-w-0"
              style={{ paddingLeft: `${paddingLeft + 8}px` }}
            >
              <ChevronRight
                className={cn(
                  'size-4 text-muted-foreground transition-transform shrink-0',
                  isExpanded && 'rotate-90'
                )}
              />
              {isExpanded ? (
                <FolderOpen className="size-4 text-muted-foreground shrink-0" />
              ) : (
                <Folder className="size-4 text-muted-foreground shrink-0" />
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex-1 text-left truncate min-w-0">{folder.name}</span>
                </TooltipTrigger>
                <TooltipContent side="right">{folder.name}</TooltipContent>
              </Tooltip>
            </button>
          </CollapsibleTrigger>
        </FolderContextMenu>
      </div>

      <CollapsibleContent className="space-y-1">
        {/* Note e sottocartelle interlacciate, nell'ordine personalizzato */}
        <SortableContext
          items={orderedItems.map(orderedItemDndId)}
          strategy={verticalListSortingStrategy}
        >
          {orderedItems.map((item) =>
            item.type === 'note' ? (
              <TreeNote
                key={item.id}
                noteId={item.id}
                folderId={folderId}
                level={level + 1}
                onDelete={onDeleteNote}
              />
            ) : (
              <TreeFolder
                key={item.id}
                folderId={item.id}
                level={level + 1}
                onCreateNote={onCreateNote}
                onCreateFolder={onCreateFolder}
                onRenameFolder={onRenameFolder}
                onDeleteFolder={onDeleteFolder}
                onDeleteNote={onDeleteNote}
              />
            )
          )}
        </SortableContext>
      </CollapsibleContent>
    </Collapsible>
  )
}
