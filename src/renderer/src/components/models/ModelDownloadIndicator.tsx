import { type FC, useMemo } from 'react'
import { Download, Pause, Play, CheckCircle2 } from 'lucide-react'
import type { ModelDefinition } from '@main/ai/types'
import { Button } from '@renderer/components/ui/button'
import { Progress } from '@renderer/components/ui/progress'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { useDownloadedModels, useModelDownload } from '@renderer/hooks/useModels'
import { useModelProfile } from '@renderer/hooks/useHardware'
import { formatSize, formatSpeed, formatETA } from '@renderer/lib/format'
import {
  FEATURES,
  resolveFeatureModels,
  computeFeatureProgress,
  type CuratedFeature,
  type FeatureProgress
} from '@renderer/lib/modelFeatures'

interface ActiveFeature {
  feature: CuratedFeature
  agg: FeatureProgress
}

/**
 * Compact top-bar indicator for model downloads happening in the background
 * (started from onboarding or Settings and left to finish). Reads the app-wide
 * download state, groups active transfers by feature, and exposes pause/resume
 * from a popover. Renders nothing while no download is in flight.
 */
export const ModelDownloadIndicator: FC = () => {
  const { progress, pause, resume } = useModelDownload()
  const { data: profile } = useModelProfile()
  const { data: downloadedModels } = useDownloadedModels()

  const downloadedIds = useMemo(
    () => new Set(downloadedModels?.map((m) => m.id) ?? []),
    [downloadedModels]
  )

  const isModelComplete = (id: string): boolean =>
    downloadedIds.has(id) || progress.get(id)?.status === 'completed'

  // Group the models that currently have progress into their feature bundles.
  const activeFeatures = useMemo<ActiveFeature[]>(() => {
    if (!profile) return []
    const result: ActiveFeature[] = []
    for (const feature of FEATURES) {
      const models: ModelDefinition[] = resolveFeatureModels(profile, feature.key)
      const touched = models.some((m) => progress.has(m.id))
      if (!touched) continue
      const agg = computeFeatureProgress(models, progress, isModelComplete)
      if (agg.activeStatus !== null) result.push({ feature, agg })
    }
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, progress, downloadedIds])

  if (activeFeatures.length === 0) return null

  const overall = activeFeatures.reduce(
    (acc, f) => {
      acc.bytesDownloaded += f.agg.bytesDownloaded
      acc.totalBytes += f.agg.totalBytes
      return acc
    },
    { bytesDownloaded: 0, totalBytes: 0 }
  )
  const overallPct =
    overall.totalBytes > 0 ? Math.round((overall.bytesDownloaded / overall.totalBytes) * 100) : 0

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-8 duration-300 animate-in fade-in zoom-in-75"
          aria-label={`Downloading models: ${overallPct}%`}
        >
          <Download className="size-4 animate-pulse text-ai" />
          <span className="absolute -bottom-0.5 -right-0.5 rounded bg-ai px-1 text-[9px] font-semibold leading-tight text-white">
            {overallPct}%
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div>
          <p className="text-sm font-medium">Downloading AI models</p>
          <p className="text-xs text-muted-foreground">
            They keep downloading while you use the app.
          </p>
        </div>

        {activeFeatures.map(({ feature, agg }) => {
          const Icon = feature.icon
          return (
            <div key={feature.key} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Icon className="size-3.5 shrink-0 text-ai" />
                <span className="text-sm font-medium">{feature.label}</span>
                <div className="flex-1" />
                <span className="text-xs text-muted-foreground">{Math.round(agg.percentage)}%</span>
              </div>
              <Progress value={agg.percentage} className="h-1.5" />
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>
                  {formatSize(agg.bytesDownloaded)} / {formatSize(agg.totalBytes)}
                  {agg.activeStatus === 'downloading' && agg.activeSpeed > 0 && (
                    <>
                      {' '}
                      · {formatSpeed(agg.activeSpeed)} · ~{formatETA(agg.activeEta)}
                    </>
                  )}
                  {agg.activeStatus === 'paused' && ' · Paused'}
                  {agg.activeStatus === 'pending' && ' · Preparing…'}
                </span>
                {agg.activeModelId &&
                  (agg.activeStatus === 'downloading' || agg.activeStatus === 'paused') && (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 font-medium text-foreground hover:text-ai"
                      onClick={() =>
                        agg.activeStatus === 'downloading'
                          ? pause(agg.activeModelId!)
                          : resume(agg.activeModelId!)
                      }
                    >
                      {agg.activeStatus === 'downloading' ? (
                        <>
                          <Pause className="size-3" /> Pause
                        </>
                      ) : (
                        <>
                          <Play className="size-3" /> Resume
                        </>
                      )}
                    </button>
                  )}
              </div>
            </div>
          )
        })}

        <div className="flex items-center gap-1.5 border-t pt-2 text-[11px] text-muted-foreground">
          <CheckCircle2 className="size-3 text-green-600" />
          Saved locally · works fully offline
        </div>
      </PopoverContent>
    </Popover>
  )
}
