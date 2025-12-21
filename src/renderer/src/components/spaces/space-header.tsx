import { type FC, useState } from 'react'
import { useActiveSpace } from '@renderer/hooks/useSpaces'
import * as Icons from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Button } from '@renderer/components/ui/button'
import { LucideIcon, MoreVertical, Pencil, Trash2 } from 'lucide-react'
import { DeleteSpaceDialog } from './delete-space-dialog'
import { EditSpaceDialog } from './edit-space-dialog'

export const SpaceHeader: FC = () => {
  const activeSpace = useActiveSpace()
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)

  if (!activeSpace) return null

  const Icon = (Icons[activeSpace.icon as keyof typeof Icons] || Icons.Home) as LucideIcon

  return (
    <>
      <div className="flex items-center justify-between pl-2 pr-1 h-14 pt-8">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" />
          <span className="uppercase text-xs text-muted-foreground">{activeSpace.name}</span>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8">
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setShowEditDialog(true)}>
              <Pencil className="size-4 mr-2" />
              Edit Space
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setShowDeleteDialog(true)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="size-4 mr-2" />
              Delete Space
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <DeleteSpaceDialog
        space={activeSpace}
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
      />
      <EditSpaceDialog space={activeSpace} open={showEditDialog} onOpenChange={setShowEditDialog} />
    </>
  )
}
