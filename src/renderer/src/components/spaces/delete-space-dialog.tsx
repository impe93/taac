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
import type { Space, FolderMetadata, Note } from '@preload/types'
import { useDeleteSpace, useSpaces, useSwitchSpace } from '@renderer/hooks/useSpaces'
import { useQueryClient } from '@tanstack/react-query'
import { useAppDispatch } from '@renderer/store/hooks'
import { deleteSpaceState } from '@renderer/store/slices/notesTreeSlice'

// Type alias per la struttura della cache multi-spazio
type SpacesCacheStructure = Record<
  string,
  {
    tree: {
      folders: Record<string, FolderMetadata>
      notes: Record<string, Note>
    }
    ui: {
      expandedFolders: string[]
      selectedNoteId: string | null
      selectedNoteFolderId: string | null
    }
    metadata: {
      lastSaved: string
      version: number
    }
  }
>

interface DeleteSpaceDialogProps {
  space: Space | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export const DeleteSpaceDialog: FC<DeleteSpaceDialogProps> = ({ space, open, onOpenChange }) => {
  const deleteSpace = useDeleteSpace()
  const { data: spaces } = useSpaces()
  const switchSpace = useSwitchSpace()
  const queryClient = useQueryClient()
  const dispatch = useAppDispatch()

  const handleDelete = async () => {
    if (!space) return

    // 1. Delete from filesystem (via IPC)
    deleteSpace.mutate(space.id, {
      onSuccess: async () => {
        // 2. Remove from Redux state
        dispatch(deleteSpaceState(space.id))

        // 3. Remove from electron-store cache
        try {
          const currentCache = (await window.config.get(
            'reduxSpacesCaches'
          )) as SpacesCacheStructure | undefined
          if (currentCache && currentCache[space.id]) {
            delete currentCache[space.id]
            await window.config.set('reduxSpacesCaches', currentCache)
          }
        } catch (error) {
          console.error('Error cleaning up space cache:', error)
        }

        // 4. If we deleted the active space, switch to another space
        const activeSpaceId = await window.config.get('activeSpaceId')
        if (activeSpaceId === space.id) {
          const remainingSpaces = spaces?.filter((s) => s.id !== space.id)
          if (remainingSpaces && remainingSpaces.length > 0) {
            // Use switchSpace mutation to properly switch to another space
            switchSpace.mutate(remainingSpaces[0].id)
          } else {
            // No spaces left
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
