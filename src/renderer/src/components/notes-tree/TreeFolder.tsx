import { type FC, useState } from 'react'
import { useAppDispatch, useAppSelector } from '@renderer/store/hooks'
import {
  toggleFolder,
  selectFolder,
  selectNotesInFolder,
  selectExpandedFolders
} from '@renderer/store/slices/notesTreeSlice'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@renderer/components/ui/collapsible'
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

  if (!folder) return null

  const isExpanded = expandedFolders.includes(folderId)

  const handleToggle = (): void => {
    dispatch(toggleFolder(folderId))
  }

  const paddingLeft = level * 12

  return (
    <Collapsible open={isExpanded} onOpenChange={handleToggle}>
      <div
        className="group relative"
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
