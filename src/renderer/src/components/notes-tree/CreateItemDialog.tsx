import { type FC, useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { useAppDispatch, useAppSelector } from '@renderer/store/hooks'
import {
  createNote,
  createFolder,
  selectActiveSpaceId
} from '@renderer/store/slices/notesTreeSlice'
import { EMPTY_EDITOR_STATE } from './constants'

interface CreateItemDialogProps {
  type: 'note' | 'folder'
  parentFolderId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export const CreateItemDialog: FC<CreateItemDialogProps> = ({
  type,
  parentFolderId,
  open,
  onOpenChange
}) => {
  const dispatch = useAppDispatch()
  const activeSpaceId = useAppSelector(selectActiveSpaceId)
  const loadingOperations = useAppSelector((state) => state.notesTree.loadingOperations)
  const [name, setName] = useState('')

  const isPending =
    type === 'note'
      ? loadingOperations[`createNote-${parentFolderId}`]
      : loadingOperations[`createFolder-${parentFolderId}`]

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setName('')
    }
  }, [open])

  const handleCreate = async (): Promise<void> => {
    if (!name.trim() || !activeSpaceId) return

    if (type === 'note') {
      await dispatch(
        createNote({
          spaceId: activeSpaceId,
          folderId: parentFolderId,
          title: name.trim(),
          content: EMPTY_EDITOR_STATE
        })
      )
    } else {
      await dispatch(
        createFolder({
          spaceId: activeSpaceId,
          name: name.trim(),
          parentId: parentFolderId
        })
      )
    }

    onOpenChange(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && name.trim() && !isPending) {
      handleCreate()
    }
  }

  const title = type === 'note' ? 'Create New Note' : 'Create New Folder'
  const description =
    type === 'note'
      ? 'Enter a title for your new note.'
      : 'Enter a name for your new folder.'
  const placeholder = type === 'note' ? 'e.g., Meeting Notes' : 'e.g., Work Projects'
  const label = type === 'note' ? 'Note Title' : 'Folder Name'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="name">{label}</Label>
            <Input
              id="name"
              placeholder={placeholder}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              maxLength={100}
              autoFocus
              disabled={isPending}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!name.trim() || isPending}>
            {isPending ? 'Creating...' : type === 'note' ? 'Create Note' : 'Create Folder'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
