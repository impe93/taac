import { type FC } from 'react'
import { BookMarked, FolderInput, FolderOpen, Laptop } from 'lucide-react'
import type { ImportSource } from '@preload/types'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent } from '@renderer/components/ui/card'
import { cn } from '@renderer/lib/utils'

interface ImportSourceSelectorProps {
  onSourceSelected: (source: ImportSource) => void
  onSkip: () => void
}

export const ImportSourceSelector: FC<ImportSourceSelectorProps> = ({
  onSourceSelected,
  onSkip
}) => {
  const isMacOS = window.platform === 'darwin'

  return (
    <div className="flex flex-col items-center space-y-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10">
        <FolderInput className="size-8 text-primary" />
      </div>

      <div className="space-y-2">
        <h1 className="font-serif text-4xl font-normal tracking-tight">Import Your Notes</h1>
        <p className="text-lg text-muted-foreground">
          Bring your existing notes into TaacNotes. Choose a source to get started.
        </p>
      </div>

      <div className={cn('grid w-full gap-4', isMacOS ? 'grid-cols-3' : 'grid-cols-2')}>
        {isMacOS && (
          <Card
            className="cursor-pointer transition-colors hover:border-primary"
            onClick={() => onSourceSelected('apple-notes')}
          >
            <CardContent className="flex flex-col items-center gap-3 pt-6">
              <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10">
                <Laptop className="size-6 text-primary" />
              </div>
              <div className="space-y-1">
                <p className="font-semibold">Apple Notes</p>
                <p className="text-sm text-muted-foreground">Import from macOS Notes app</p>
              </div>
            </CardContent>
          </Card>
        )}

        <Card
          className="cursor-pointer transition-colors hover:border-primary"
          onClick={() => onSourceSelected('obsidian')}
        >
          <CardContent className="flex flex-col items-center gap-3 pt-6">
            <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10">
              <FolderOpen className="size-6 text-primary" />
            </div>
            <div className="space-y-1">
              <p className="font-semibold">Obsidian</p>
              <p className="text-sm text-muted-foreground">Import from Obsidian vault</p>
            </div>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer transition-colors hover:border-primary"
          onClick={() => onSourceSelected('joplin')}
        >
          <CardContent className="flex flex-col items-center gap-3 pt-6">
            <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10">
              <BookMarked className="size-6 text-primary" />
            </div>
            <div className="space-y-1">
              <p className="font-semibold">Joplin</p>
              <p className="text-sm text-muted-foreground">Import from Joplin Markdown export</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Button variant="ghost" onClick={onSkip}>
        Skip import
      </Button>
    </div>
  )
}
