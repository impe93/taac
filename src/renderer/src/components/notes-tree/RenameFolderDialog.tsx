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
import { updateFolder, selectActiveSpaceId } from '@renderer/store/slices/notesTreeSlice'

interface RenameFolderDialogProps {
  folderId: string
  currentName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export const RenameFolderDialog: FC<RenameFolderDialogProps> = ({
  folderId,
  currentName,
  open,
  onOpenChange
}) => {
  const dispatch = useAppDispatch()
  const activeSpaceId = useAppSelector(selectActiveSpaceId)
  const [name, setName] = useState(currentName)
  const [isPending, setIsPending] = useState(false)

  useEffect(() => {
    if (open) {
      setName(currentName)
    }
  }, [open, currentName])

  const handleRename = async (): Promise<void> => {
    const trimmedName = name.trim()
    if (!trimmedName || !activeSpaceId || trimmedName === currentName) {
      onOpenChange(false)
      return
    }

    setIsPending(true)
    await dispatch(updateFolder({ spaceId: activeSpaceId, folderId, updates: { name: trimmedName } }))
    setIsPending(false)
    onOpenChange(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && name.trim() && !isPending) {
      handleRename()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename Folder</DialogTitle>
          <DialogDescription>Enter a new name for this folder.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="folder-name">Folder Name</Label>
            <Input
              id="folder-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              maxLength={100}
              autoFocus
              disabled={isPending}
              onFocus={(e) => e.target.select()}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleRename} disabled={!name.trim() || isPending}>
            {isPending ? 'Renaming...' : 'Rename'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
