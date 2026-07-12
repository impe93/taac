import { type FC } from 'react'
import { Download, Pause, Play, CheckCircle2, X, Trash2 } from 'lucide-react'
import type { DownloadProgress, ModelDefinition } from '@main/ai/types'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Progress } from '@renderer/components/ui/progress'
import { formatSize, formatSpeed, formatETA } from '@renderer/lib/format'

interface ModelRowProps {
  model: ModelDefinition
  label: string
  icon: FC<{ className?: string }>
  isDownloaded: boolean
  downloadProgress?: DownloadProgress
  onDownload: (id: string) => void
  onPause: (id: string) => void
  onResume: (id: string) => void
  /** Settings-only: enables the Cancel action while a download is in progress. */
  onCancel?: (id: string) => void
  /** Settings-only: enables the Delete action once a model is downloaded. */
  onDelete?: (id: string) => void
}

/**
 * Row for a single model inside a feature card's "Show details" section: name,
 * capability badge, size, and contextual actions (download / pause / resume /
 * cancel / delete). Delete and cancel are opt-in via handlers so the onboarding
 * wizard can render read-only-ish rows while Settings gets full management.
 */
export const ModelRow: FC<ModelRowProps> = ({
  model,
  label,
  icon: Icon,
  isDownloaded,
  downloadProgress,
  onDownload,
  onPause,
  onResume,
  onCancel,
  onDelete
}) => {
  const isDownloading = downloadProgress?.status === 'downloading'
  const isPaused = downloadProgress?.status === 'paused'
  const hasError = downloadProgress?.status === 'error'
  const isInProgress = isDownloading || isPaused

  return (
    <div className="space-y-2 rounded-md border border-border/50 bg-muted/30 p-2.5">
      {/* Top row: icon + name + size */}
      <div className="flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">{model.name}</span>
        <Badge variant="outline" className="shrink-0 text-[10px]">
          {label}
        </Badge>
        <div className="flex-1" />
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatSize(model.sizeBytes)}
        </span>
      </div>

      {/* Download progress */}
      {isInProgress && downloadProgress && (
        <div className="space-y-1">
          <Progress value={downloadProgress.percentage} className="h-1.5" />
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{downloadProgress.percentage.toFixed(0)}%</span>
            {isDownloading && (
              <span>
                {formatSpeed(downloadProgress.speed)} · ~{formatETA(downloadProgress.eta)}
              </span>
            )}
            {isPaused && <span>Paused</span>}
          </div>
        </div>
      )}

      {hasError && downloadProgress && (
        <p className="text-xs text-destructive">{downloadProgress.error || 'Download failed'}</p>
      )}

      {/* Actions row */}
      <div className="flex items-center gap-2">
        {isInProgress ? (
          <>
            {isDownloading ? (
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={() => onPause(model.id)}
              >
                <Pause className="size-3" />
                Pause
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={() => onResume(model.id)}
              >
                <Play className="size-3" />
                Resume
              </Button>
            )}
            {onCancel && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs text-destructive hover:text-destructive"
                onClick={() => onCancel(model.id)}
              >
                <X className="size-3" />
                Cancel
              </Button>
            )}
          </>
        ) : hasError ? (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => onDownload(model.id)}
          >
            <Download className="size-3" />
            Retry
          </Button>
        ) : isDownloaded ? (
          <>
            <Badge
              variant="outline"
              className="gap-1 border-green-500/20 bg-green-500/15 text-green-700 dark:text-green-400"
            >
              <CheckCircle2 className="size-3" />
              Downloaded
            </Badge>
            {onDelete && (
              <>
                <div className="flex-1" />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs text-destructive hover:text-destructive"
                  onClick={() => onDelete(model.id)}
                >
                  <Trash2 className="size-3" />
                  Delete
                </Button>
              </>
            )}
          </>
        ) : (
          <Button size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => onDownload(model.id)}>
            <Download className="size-3" />
            Download
          </Button>
        )}
      </div>
    </div>
  )
}
