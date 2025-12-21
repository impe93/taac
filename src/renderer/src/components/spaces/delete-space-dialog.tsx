import { type FC } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@renderer/components/ui/alert-dialog'
import type { Space } from '@preload/types'
import { useDeleteSpace, useSpaces } from '@renderer/hooks/useSpaces'
import { useQueryClient } from '@tanstack/react-query'

interface DeleteSpaceDialogProps {
  space: Space | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export const DeleteSpaceDialog: FC<DeleteSpaceDialogProps> = ({ space, open, onOpenChange }) => {
  const deleteSpace = useDeleteSpace()
  const { data: spaces } = useSpaces()
  const queryClient = useQueryClient()

  const handleDelete = async () => {
    if (!space) return

    deleteSpace.mutate(space.id, {
      onSuccess: async () => {
        // If we deleted the active space, switch to the first available space
        const activeSpaceId = await window.config.get('activeSpaceId')
        if (activeSpaceId === space.id) {
          const remainingSpaces = spaces?.filter((s) => s.id !== space.id)
          if (remainingSpaces && remainingSpaces.length > 0) {
            await window.config.set('activeSpaceId', remainingSpaces[0].id)
            queryClient.setQueryData(['config', 'activeSpaceId'], remainingSpaces[0].id)
          } else {
            await window.config.set('activeSpaceId', null)
            queryClient.setQueryData(['config', 'activeSpaceId'], null)
          }
        }
        onOpenChange(false)
      }
    })
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Space "{space?.name}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete all notes and folders in this space. This action cannot be
            undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleteSpace.isPending ? 'Deleting...' : 'Delete Space'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
