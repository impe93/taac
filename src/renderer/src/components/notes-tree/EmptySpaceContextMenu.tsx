import { type FC } from 'react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@renderer/components/ui/context-menu'
import { FileText, FolderPlus } from 'lucide-react'

interface EmptySpaceContextMenuProps {
  onCreateNote: () => void
  onCreateFolder: () => void
  children: React.ReactNode
}

export const EmptySpaceContextMenu: FC<EmptySpaceContextMenuProps> = ({
  onCreateNote,
  onCreateFolder,
  children
}) => {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onCreateNote}>
          <FileText className="size-4 mr-2" />
          New Note
        </ContextMenuItem>
        <ContextMenuItem onClick={onCreateFolder}>
          <FolderPlus className="size-4 mr-2" />
          New Folder
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
