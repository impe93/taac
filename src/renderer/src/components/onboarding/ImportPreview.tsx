import { type FC, useState } from 'react'
import { AlertCircle, ArrowLeft, ChevronDown, FolderInput, Loader2 } from 'lucide-react'
import type { ImportScanResult } from '@preload/types'
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent } from '@renderer/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@renderer/components/ui/collapsible'
import { Separator } from '@renderer/components/ui/separator'
import { formatSize } from '@renderer/lib/format'
import { cn } from '@renderer/lib/utils'
import type { OnboardingState } from './OnboardingWizard'

interface ImportPreviewProps {
  scanResult: ImportScanResult
  state: OnboardingState
  onStartImport: () => void
  onBack: () => void
  isStarting: boolean
}

export const ImportPreview: FC<ImportPreviewProps> = ({
  scanResult,
  state,
  onStartImport,
  onBack,
  isStarting
}) => {
  const [titlesOpen, setTitlesOpen] = useState(false)

  const sourceLabel = state.import.source === 'apple-notes' ? 'Apple Notes' : 'Obsidian'
  const targetLabel =
    state.import.targetMode === 'new-space'
      ? `New space: "${state.import.newSpaceName}"`
      : 'Existing space'

  return (
    <div className="flex flex-col items-center space-y-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10">
        <FolderInput className="size-8 text-primary" />
      </div>

      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Review Import</h1>
        <p className="text-lg text-muted-foreground">
          Here&#39;s what will be imported from {sourceLabel}.
        </p>
      </div>

      <Card className="w-full text-left">
        <CardContent className="space-y-3 pt-6">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Notes</span>
            <span className="text-sm font-medium">{scanResult.totalFiles}</span>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Folders</span>
            <span className="text-sm font-medium">{scanResult.folders.length}</span>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Total size</span>
            <span className="text-sm font-medium">{formatSize(scanResult.totalSizeBytes)}</span>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Attachments</span>
            <Badge variant="secondary">{scanResult.hasAttachments ? 'Yes' : 'No'}</Badge>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Destination</span>
            <span className="text-sm font-medium">{targetLabel}</span>
          </div>
        </CardContent>
      </Card>

      {scanResult.sampleTitles.length > 0 && (
        <Collapsible open={titlesOpen} onOpenChange={setTitlesOpen} className="w-full">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-between">
              Sample notes ({scanResult.sampleTitles.length})
              <ChevronDown
                className={cn('size-4 transition-transform', titlesOpen && 'rotate-180')}
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-lg border p-3 text-left">
              {scanResult.sampleTitles.map((title, i) => (
                <p key={i} className="truncate text-sm text-muted-foreground">
                  {title}
                </p>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {scanResult.warnings.length > 0 && (
        <Alert variant="destructive" className="text-left">
          <AlertCircle className="size-4" />
          <AlertTitle>Warnings</AlertTitle>
          <AlertDescription>
            <ul className="list-inside list-disc text-sm">
              {scanResult.warnings.map((warning, i) => (
                <li key={i}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex items-center gap-3">
        <Button variant="ghost" onClick={onBack} disabled={isStarting}>
          <ArrowLeft className="size-4" />
          Back
        </Button>
        <Button size="lg" onClick={onStartImport} disabled={isStarting}>
          {isStarting && <Loader2 className="size-4 animate-spin" />}
          Start Import
        </Button>
      </div>
    </div>
  )
}
