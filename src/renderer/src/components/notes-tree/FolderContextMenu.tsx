import { type FC } from 'react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@renderer/components/ui/context-menu'
import { FileText, FolderPlus, Trash2 } from 'lucide-react'

interface FolderContextMenuProps {
  folderId: string
  folderName: string
  onCreateNote: () => void
  onCreateFolder: () => void
  onDelete: () => void
  children: React.ReactNode
}

export const FolderContextMenu: FC<FolderContextMenuProps> = ({
  onCreateNote,
  onCreateFolder,
  onDelete,
  children
}) => {
  return (
    <ContextMenu>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onCreateNote}>
          <FileText className="size-4 mr-2" />
          New Note
        </ContextMenuItem>
        <ContextMenuItem onClick={onCreateFolder}>
          <FolderPlus className="size-4 mr-2" />
          New Folder
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={onDelete}>
          <Trash2 className="size-4 mr-2" />
          Delete Folder
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
