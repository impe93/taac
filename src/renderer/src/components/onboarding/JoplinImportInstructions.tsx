import { type FC } from 'react'
import { FolderOpen } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'

interface JoplinImportInstructionsProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Opens the native folder picker for the Joplin export and continues. */
  onSelectFolder: () => void
}

const STEPS: string[] = [
  'Open Joplin on your desktop.',
  'Go to File → Export all → MD - Markdown + Front Matter.',
  'Choose an empty folder to export into.'
]

export const JoplinImportInstructions: FC<JoplinImportInstructionsProps> = ({
  open,
  onOpenChange,
  onSelectFolder
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export from Joplin first</DialogTitle>
          <DialogDescription>
            Joplin keeps notes in its own database, so export them to Markdown before importing.
          </DialogDescription>
        </DialogHeader>

        <ol className="space-y-3 py-2">
          {STEPS.map((step, index) => (
            <li key={index} className="flex items-start gap-3 text-sm">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {index + 1}
              </span>
              <span className="pt-0.5">{step}</span>
            </li>
          ))}
        </ol>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSelectFolder}>
            <FolderOpen className="size-4" />
            Select export folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
