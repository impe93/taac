import { type FC } from 'react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@renderer/components/ui/context-menu'
import { Trash2 } from 'lucide-react'

interface NoteContextMenuProps {
  noteId: string
  noteName: string
  folderId: string
  onDelete: () => void
  children: React.ReactNode
}

export const NoteContextMenu: FC<NoteContextMenuProps> = ({ onDelete, children }) => {
  return (
    <ContextMenu>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem variant="destructive" onClick={onDelete}>
          <Trash2 className="size-4 mr-2" />
          Delete Note
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
