import { type FC, useState, useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
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
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group'
import { useAppDispatch, useAppSelector } from '@renderer/store/hooks'
import {
  createNote,
  createFolder,
  selectActiveSpaceId
} from '@renderer/store/slices/notesTreeSlice'
import { EMPTY_EDITOR_STATE } from './constants'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useMeetingModelsReady } from '@renderer/hooks/useMeetingModelsReady'
import { FileText, Mic } from 'lucide-react'

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
  const navigate = useNavigate()
  const activeSpaceId = useAppSelector(selectActiveSpaceId)
  const loadingOperations = useAppSelector((state) => state.notesTree.loadingOperations)
  const [name, setName] = useState('')
  const [noteType, setNoteType] = useState<'note' | 'meeting'>('note')
  const { isReady: meetingModelsReady } = useMeetingModelsReady()

  const isPending =
    type === 'note'
      ? loadingOperations[`createNote-${parentFolderId}`]
      : loadingOperations[`createFolder-${parentFolderId}`]

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setName('')
      setNoteType('note')
    }
  }, [open])

  const handleCreate = async (): Promise<void> => {
    if (!name.trim() || !activeSpaceId) return

    if (type === 'note') {
      const result = await dispatch(
        createNote({
          spaceId: activeSpaceId,
          folderId: parentFolderId,
          title: name.trim(),
          content: EMPTY_EDITOR_STATE,
          type: noteType
        })
      )
      if (createNote.fulfilled.match(result)) {
        navigate({ to: '/note/$noteId', params: { noteId: result.payload.note.id } })
      }
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
    type === 'note' ? 'Enter a title for your new note.' : 'Enter a name for your new folder.'
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
          {type === 'note' && (
            <div className="grid gap-2">
              <Label>Note Type</Label>
              <ToggleGroup
                type="single"
                value={noteType}
                onValueChange={(value) => {
                  if (value && (value !== 'meeting' || meetingModelsReady))
                    setNoteType(value as 'note' | 'meeting')
                }}
                variant="outline"
                className="w-full"
              >
                <ToggleGroupItem value="note" className="flex-1 gap-2">
                  <FileText className="size-4" />
                  Note
                </ToggleGroupItem>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex flex-1">
                      <ToggleGroupItem
                        value="meeting"
                        className="flex-1 gap-2"
                        disabled={!meetingModelsReady}
                      >
                        <Mic className="size-4" />
                        Meeting Note
                      </ToggleGroupItem>
                    </span>
                  </TooltipTrigger>
                  {!meetingModelsReady && (
                    <TooltipContent side="bottom">
                      <p>Download the required AI models in Settings to enable Meeting Notes</p>
                    </TooltipContent>
                  )}
                </Tooltip>
              </ToggleGroup>
            </div>
          )}
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
