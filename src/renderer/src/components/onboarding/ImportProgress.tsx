import { type FC, useState } from 'react'
import { CheckCircle2, ChevronDown, Loader2 } from 'lucide-react'
import type { ImportProgressEvent, ImportResult } from '@preload/types'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent } from '@renderer/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@renderer/components/ui/collapsible'
import { Progress } from '@renderer/components/ui/progress'
import { Separator } from '@renderer/components/ui/separator'
import { cn } from '@renderer/lib/utils'

interface ImportProgressProps {
  progress: ImportProgressEvent | null
  importResult: ImportResult | null
  onComplete: () => void
}

const PHASE_LABELS: Record<ImportProgressEvent['phase'], string> = {
  scanning: 'Scanning notes...',
  converting: 'Converting notes...',
  creating: 'Creating notes...',
  complete: 'Import complete!'
}

export const ImportProgress: FC<ImportProgressProps> = ({ progress, importResult, onComplete }) => {
  const [errorsOpen, setErrorsOpen] = useState(false)

  const isComplete = importResult !== null
  const hasErrors = isComplete && importResult.errors.length > 0

  const percentage = progress
    ? progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0
    : isComplete
      ? 100
      : 0

  if (isComplete) {
    return (
      <div className="flex flex-col items-center space-y-6 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10">
          <CheckCircle2 className="size-8 text-primary" />
        </div>

        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Import Complete</h1>
          <p className="text-lg text-muted-foreground">
            Your notes have been successfully imported.
          </p>
        </div>

        <Card className="w-full text-left">
          <CardContent className="space-y-3 pt-6">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Notes imported</span>
              <span className="text-sm font-medium">{importResult.importedNotes}</span>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Folders created</span>
              <span className="text-sm font-medium">{importResult.importedFolders}</span>
            </div>
            {importResult.importedAttachments > 0 && (
              <>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Attachments</span>
                  <span className="text-sm font-medium">{importResult.importedAttachments}</span>
                </div>
              </>
            )}
            {importResult.skippedFiles > 0 && (
              <>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Skipped</span>
                  <span className="text-sm font-medium text-muted-foreground">
                    {importResult.skippedFiles}
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {hasErrors && (
          <Collapsible open={errorsOpen} onOpenChange={setErrorsOpen} className="w-full">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full justify-between text-destructive">
                {importResult.errors.length} error
                {importResult.errors.length > 1 ? 's' : ''} during import
                <ChevronDown
                  className={cn('size-4 transition-transform', errorsOpen && 'rotate-180')}
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-lg border p-3 text-left">
                {importResult.errors.map((err, i) => (
                  <p key={i} className="truncate text-xs text-muted-foreground">
                    <span className="font-medium">{err.filePath}:</span> {err.error}
                  </p>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        <Button size="lg" onClick={onComplete}>
          Continue
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center space-y-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>

      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Importing Notes</h1>
        <p className="text-lg text-muted-foreground">
          {progress ? PHASE_LABELS[progress.phase] : 'Preparing import...'}
        </p>
      </div>

      <div className="w-full space-y-2">
        <Progress value={percentage} />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="max-w-[70%] truncate">
            {progress?.currentFile ? `Processing: ${progress.currentFile}` : 'Preparing...'}
          </span>
          <span>{progress ? `${progress.current} / ${progress.total}` : ''}</span>
        </div>
      </div>
    </div>
  )
}
