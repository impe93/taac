import { type FC, type ReactNode, useMemo, useState } from 'react'
import { Download, Pause, Play, CheckCircle2, AlertCircle, ChevronDown } from 'lucide-react'
import type { DownloadProgress, ModelDefinition } from '@main/ai/types'
import { Card, CardContent } from '@renderer/components/ui/card'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Progress } from '@renderer/components/ui/progress'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@renderer/components/ui/collapsible'
import { formatSize, formatSpeed, formatETA } from '@renderer/lib/format'
import { computeFeatureProgress, type CuratedFeature } from '@renderer/lib/modelFeatures'
import { ModelRow } from './ModelRow'
import { AdvancedModels } from './AdvancedModels'
import { modelLabel } from './modelLabel'

interface ModelFeatureCardProps {
  feature: CuratedFeature
  recommended: ModelDefinition[]
  alternatives?: ModelDefinition[]
  downloadedModelIds: Set<string>
  progress: Map<string, DownloadProgress>
  onDownload: (id: string) => void
  onPause: (id: string) => void
  onResume: (id: string) => void
  /** Settings-only: enables per-model Cancel while downloading. */
  onCancel?: (id: string) => void
  /** Settings-only: enables per-model Delete once downloaded. */
  onDelete?: (id: string) => void
}

/**
 * Feature-grouped card shared by the onboarding wizard and the settings page.
 * Leads with a plain-language benefit and the bundle size on the Download
 * button, keeps the individual models tucked behind a "Show details" accordion
 * (with a further "Advanced" toggle for alternative variants), and surfaces
 * aggregate download progress with pause/resume. Model management (delete /
 * cancel) is opt-in via the `onDelete` / `onCancel` handlers.
 */
export const ModelFeatureCard: FC<ModelFeatureCardProps> = ({
  feature,
  recommended,
  alternatives = [],
  downloadedModelIds,
  progress,
  onDownload,
  onPause,
  onResume,
  onCancel,
  onDelete
}) => {
  const Icon = feature.icon
  const [detailsOpen, setDetailsOpen] = useState(false)

  const isComplete = (id: string): boolean =>
    downloadedModelIds.has(id) || progress.get(id)?.status === 'completed'

  const allComplete = recommended.length > 0 && recommended.every((m) => isComplete(m.id))
  const missingIds = recommended.filter((m) => !isComplete(m.id)).map((m) => m.id)
  const totalBytes = recommended.reduce((acc, m) => acc + m.sizeBytes, 0)

  const agg = useMemo(
    () => computeFeatureProgress(recommended, progress, isComplete),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recommended, progress, downloadedModelIds]
  )
  const isDownloading = agg.activeStatus !== null
  const showError = !!agg.lastError && !isDownloading && !allComplete

  const renderRow = (model: ModelDefinition): ReactNode => (
    <ModelRow
      key={model.id}
      model={model}
      label={modelLabel(model)}
      icon={Icon}
      isDownloaded={downloadedModelIds.has(model.id)}
      downloadProgress={progress.get(model.id)}
      onDownload={onDownload}
      onPause={onPause}
      onResume={onResume}
      onCancel={onCancel}
      onDelete={onDelete}
    />
  )

  return (
    <Card className="py-4 text-left">
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-ai-soft">
              <Icon className="size-5 text-ai" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{feature.label}</p>
                {feature.optional && (
                  <Badge variant="outline" className="text-xs">
                    Optional
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{feature.benefit}</p>
            </div>
          </div>

          <div className="shrink-0">
            {allComplete ? (
              <Badge variant="secondary" className="gap-1">
                <CheckCircle2 className="size-3" />
                Ready
              </Badge>
            ) : !isDownloading ? (
              <Button size="sm" className="gap-1.5" onClick={() => missingIds.forEach(onDownload)}>
                <Download className="size-3.5" />
                Download · {formatSize(totalBytes)}
              </Button>
            ) : null}
          </div>
        </div>

        {isDownloading && (
          <div className="space-y-2">
            <Progress value={agg.percentage} />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {formatSize(agg.bytesDownloaded)} / {formatSize(agg.totalBytes)}
                {agg.activeStatus === 'downloading' && agg.activeSpeed > 0 && (
                  <>
                    {' '}
                    &middot; {formatSpeed(agg.activeSpeed)} &middot; ~{formatETA(agg.activeEta)}
                  </>
                )}
                {agg.activeStatus === 'paused' && ' · Paused'}
                {agg.activeStatus === 'pending' && ' · Preparing…'}
              </span>
              <span>{Math.round(agg.percentage)}%</span>
            </div>
            {agg.activeModelId &&
              (agg.activeStatus === 'downloading' || agg.activeStatus === 'paused') && (
                <div className="flex justify-end">
                  {agg.activeStatus === 'downloading' ? (
                    <Button variant="ghost" size="sm" onClick={() => onPause(agg.activeModelId!)}>
                      <Pause className="size-3.5" />
                      Pause
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => onResume(agg.activeModelId!)}>
                      <Play className="size-3.5" />
                      Resume
                    </Button>
                  )}
                </div>
              )}
          </div>
        )}

        {showError && (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertDescription className="flex items-center justify-between">
              <span>{agg.lastError}</span>
              <Button variant="ghost" size="sm" onClick={() => missingIds.forEach(onDownload)}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
          <CollapsibleTrigger className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
            <ChevronDown
              className={`size-3.5 transition-transform ${detailsOpen ? 'rotate-180' : ''}`}
            />
            {detailsOpen ? 'Hide details' : 'Show details'}
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 space-y-2">
            {recommended.map(renderRow)}
            {alternatives.length > 0 && (
              <AdvancedModels label="more/less powerful models">
                {alternatives.map(renderRow)}
              </AdvancedModels>
            )}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  )
}
