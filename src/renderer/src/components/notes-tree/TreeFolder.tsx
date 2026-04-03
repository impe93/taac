import { type FC, useEffect, useRef } from 'react'
import { useAppDispatch, useAppSelector } from '@renderer/store/hooks'
import {
  toggleFolder,
  selectFolder,
  selectNotesInFolder,
  selectExpandedFolders,
  expandFolder
} from '@renderer/store/slices/notesTreeSlice'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@renderer/components/ui/collapsible'
import { ChevronRight, Folder, FolderOpen } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { TreeNote } from './TreeNote'
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
  const notes = useAppSelector(selectNotesInFolder(folderId))
  const expandedFolders = useAppSelector(selectExpandedFolders)
  // HOOKS MUST BE CALLED BEFORE ANY CONDITIONAL RETURNS
  // Setup draggable
  const {
    attributes: dragAttributes,
    listeners: dragListeners,
    setNodeRef: setDragRef,
    transform: dragTransform,
    isDragging
  } = useDraggable({
    id: `folder-${folderId}`,
    data: {
      type: 'folder',
      id: folderId,
      folderId: folder?.parentId || 'root',
      name: folder?.name || 'Unnamed Folder'
    }
  })

  // Setup droppable
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `folder-drop-${folderId}`,
    data: {
      type: 'folder',
      folderId: folderId
    }
  })

  // Auto-expand on hover during drag
  const expandTimerRef = useRef<NodeJS.Timeout | null>(null)
  const isExpanded = expandedFolders.includes(folderId)

  useEffect(() => {
    if (isOver && !isExpanded) {
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
  }, [isOver, isExpanded, folderId, dispatch])

  // NOW we can do conditional returns
  if (!folder) return null

  const handleToggle = (): void => {
    dispatch(toggleFolder(folderId))
  }

  const paddingLeft = level * 12

  // Combine refs
  const setRefs = (element: HTMLElement | null): void => {
    setDragRef(element)
    setDropRef(element)
  }

  const style = {
    transform: CSS.Translate.toString(dragTransform),
    opacity: isDragging ? 0.5 : 1
  }

  return (
    <Collapsible open={isExpanded} onOpenChange={handleToggle}>
      <div
        ref={setRefs}
        style={style}
        className={cn('group relative', isOver && 'bg-accent/50 ring-2 ring-primary/50 rounded-md')}
      >
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
              {...dragAttributes}
              {...dragListeners}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent text-sm transition-colors min-w-0"
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
        {/* Note in questa cartella */}
        {notes.map((note) => (
          <TreeNote
            key={note.id}
            noteId={note.id}
            folderId={folderId}
            level={level + 1}
            onDelete={onDeleteNote}
          />
        ))}

        {/* Sotto-cartelle (RICORSIVO) */}
        {folder.children.map((childId) => (
          <TreeFolder
            key={childId}
            folderId={childId}
            level={level + 1}
            onCreateNote={onCreateNote}
            onCreateFolder={onCreateFolder}
            onRenameFolder={onRenameFolder}
            onDeleteFolder={onDeleteFolder}
            onDeleteNote={onDeleteNote}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}
