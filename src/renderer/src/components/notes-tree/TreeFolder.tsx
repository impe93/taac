import { type FC, useState, useEffect, useRef } from 'react'
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
import { ChevronRight, Folder, FolderOpen, MoreHorizontal } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { TreeNote } from './TreeNote'
import { FolderContextMenu } from './FolderContextMenu'
import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { FileText, FolderPlus, Trash2 } from 'lucide-react'

interface TreeFolderProps {
  folderId: string
  level: number
  onCreateNote: (folderId: string) => void
  onCreateFolder: (folderId: string) => void
  onDeleteFolder: (folderId: string, folderName: string) => void
  onDeleteNote: (noteId: string, noteName: string, folderId: string) => void
}

export const TreeFolder: FC<TreeFolderProps> = ({
  folderId,
  level,
  onCreateNote,
  onCreateFolder,
  onDeleteFolder,
  onDeleteNote
}) => {
  const dispatch = useAppDispatch()
  const folder = useAppSelector(selectFolder(folderId))
  const notes = useAppSelector(selectNotesInFolder(folderId))
  const expandedFolders = useAppSelector(selectExpandedFolders)
  const [showActions, setShowActions] = useState(false)

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
        onMouseEnter={() => setShowActions(true)}
        onMouseLeave={() => setShowActions(false)}
      >
        <FolderContextMenu
          folderId={folderId}
          folderName={folder.name}
          onCreateNote={() => onCreateNote(folderId)}
          onCreateFolder={() => onCreateFolder(folderId)}
          onDelete={() => onDeleteFolder(folderId, folder.name)}
        >
          <CollapsibleTrigger asChild>
            <button
              {...dragAttributes}
              {...dragListeners}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent text-sm transition-colors"
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
              <span className="flex-1 text-left truncate">{folder.name}</span>
            </button>
          </CollapsibleTrigger>
        </FolderContextMenu>

        {/* Dropdown menu pulsante 3 puntini hover */}
        {showActions && (
          <div className="absolute right-1 top-1 z-10">
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon" className="size-6">
                  <MoreHorizontal className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onCreateNote(folderId)}>
                  <FileText className="size-4 mr-2" />
                  New Note
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onCreateFolder(folderId)}>
                  <FolderPlus className="size-4 mr-2" />
                  New Folder
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => onDeleteFolder(folderId, folder.name)}
                >
                  <Trash2 className="size-4 mr-2" />
                  Delete Folder
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
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
            onDeleteFolder={onDeleteFolder}
            onDeleteNote={onDeleteNote}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}
