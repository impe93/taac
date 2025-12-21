import { type FC, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Button } from '@renderer/components/ui/button'
import { Label } from '@renderer/components/ui/label'
import { IconPicker } from './icon-picker'
import { useCreateSpace, useSpaces } from '@renderer/hooks/useSpaces'

interface CreateSpaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export const CreateSpaceDialog: FC<CreateSpaceDialogProps> = ({ open, onOpenChange }) => {
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('Briefcase')
  const createSpace = useCreateSpace()
  const { data: spaces } = useSpaces()

  const canCreate = spaces && spaces.length < 5

  const handleCreate = () => {
    if (!name.trim()) return
    if (!canCreate) return

    createSpace.mutate(
      { name: name.trim(), icon },
      {
        onSuccess: () => {
          onOpenChange(false)
          setName('')
          setIcon('Briefcase')
        }
      }
    )
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setName('')
      setIcon('Briefcase')
    }
    onOpenChange(newOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Space</DialogTitle>
          <DialogDescription>
            {canCreate
              ? 'Create a new space to organize your notes. You can have up to 5 spaces.'
              : 'You have reached the maximum of 5 spaces. Delete a space to create a new one.'}
          </DialogDescription>
        </DialogHeader>

        {canCreate && (
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Space Name</Label>
              <Input
                id="name"
                placeholder="e.g., Work, Personal, Projects"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={50}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && name.trim()) {
                    handleCreate()
                  }
                }}
              />
            </div>

            <div className="grid gap-2">
              <Label>Icon</Label>
              <IconPicker value={icon} onChange={setIcon} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          {canCreate && (
            <Button onClick={handleCreate} disabled={!name.trim() || createSpace.isPending}>
              {createSpace.isPending ? 'Creating...' : 'Create Space'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
