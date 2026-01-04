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
import { useAppDispatch, useAppSelector } from '@renderer/store/hooks'
import { deleteNote, deleteFolder } from '@renderer/store/slices/notesTreeSlice'

interface DeleteItemDialogProps {
  type: 'note' | 'folder'
  itemId: string
  itemName: string
  folderId?: string // Required for notes
  open: boolean
  onOpenChange: (open: boolean) => void
}

export const DeleteItemDialog: FC<DeleteItemDialogProps> = ({
  type,
  itemId,
  itemName,
  folderId,
  open,
  onOpenChange
}) => {
  const dispatch = useAppDispatch()
  const loadingOperations = useAppSelector((state) => state.notesTree.loadingOperations)

  const isPending =
    type === 'note'
      ? loadingOperations[`deleteNote-${itemId}`]
      : loadingOperations[`deleteFolder-${itemId}`]

  const handleDelete = async (): Promise<void> => {
    if (type === 'note') {
      if (!folderId) {
        console.error('folderId is required for deleting notes')
        return
      }
      await dispatch(deleteNote({ noteId: itemId, folderId }))
    } else {
      await dispatch(deleteFolder({ folderId: itemId }))
    }
    onOpenChange(false)
  }

  const title = type === 'note' ? 'Delete Note' : 'Delete Folder'
  const description =
    type === 'note'
      ? `Are you sure you want to delete "${itemName}"? This action cannot be undone.`
      : `Are you sure you want to delete "${itemName}" and all its contents? This will permanently delete all notes and subfolders inside. This action cannot be undone.`

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isPending ? 'Deleting...' : type === 'note' ? 'Delete Note' : 'Delete Folder'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
