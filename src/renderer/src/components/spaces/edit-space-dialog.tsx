import { type FC, useState, useEffect } from 'react'
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
import { useUpdateSpace } from '@renderer/hooks/useSpaces'
import type { Space } from '@preload/types'

interface EditSpaceDialogProps {
  space: Space | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export const EditSpaceDialog: FC<EditSpaceDialogProps> = ({ space, open, onOpenChange }) => {
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('Briefcase')
  const updateSpace = useUpdateSpace()

  useEffect(() => {
    if (space) {
      setName(space.name)
      setIcon(space.icon)
    }
  }, [space])

  const handleUpdate = () => {
    if (!space || !name.trim()) return

    updateSpace.mutate(
      { spaceId: space.id, updates: { name: name.trim(), icon } },
      {
        onSuccess: () => {
          onOpenChange(false)
        }
      }
    )
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen && space) {
      setName(space.name)
      setIcon(space.icon)
    }
    onOpenChange(newOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Space</DialogTitle>
          <DialogDescription>Update the name and icon of your space.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="edit-name">Space Name</Label>
            <Input
              id="edit-name"
              placeholder="e.g., Work, Personal, Projects"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={50}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && name.trim()) {
                  handleUpdate()
                }
              }}
            />
          </div>

          <div className="grid gap-2">
            <Label>Icon</Label>
            <IconPicker value={icon} onChange={setIcon} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleUpdate} disabled={!name.trim() || updateSpace.isPending}>
            {updateSpace.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
