import { type FC } from 'react'
import {
  Download,
  Trash2,
  Pause,
  Play,
  X,
  CheckCircle2,
  MessageSquare,
  Code2,
  Brain,
  Sparkles
} from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@renderer/components/ui/card'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Progress } from '@renderer/components/ui/progress'
import { cn } from '@renderer/lib/utils'
import type {
  ModelDefinition,
  DownloadProgress,
  HardwareTier,
  ModelCapability
} from '@main/ai/types'

interface ModelCardProps {
  model: ModelDefinition
  isDownloaded: boolean
  downloadProgress?: DownloadProgress
  onDownload: (modelId: string) => void
  onDelete: (modelId: string) => void
  onPause?: (modelId: string) => void
  onResume?: (modelId: string) => void
  onCancel?: (modelId: string) => void
  className?: string
}

const tierConfig: Record<HardwareTier, { label: string; className: string }> = {
  low: {
    label: 'Low',
    className: 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20'
  },
  medium: {
    label: 'Medium',
    className: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/20'
  },
  high: {
    label: 'High',
    className: 'bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/20'
  },
  ultra: {
    label: 'Ultra',
    className: 'bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/20'
  }
}

const capabilityConfig: Record<
  ModelCapability,
  { label: string; icon: FC<{ className?: string }> }
> = {
  chat: { label: 'Chat', icon: MessageSquare },
  embedding: { label: 'Embedding', icon: Sparkles },
  code: { label: 'Code', icon: Code2 },
  reasoning: { label: 'Reasoning', icon: Brain }
}

const formatSize = (bytes: number): string => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let unitIndex = 0
  let size = bytes

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }

  const decimals = unitIndex >= 3 ? 1 : 0
  return `${size.toFixed(decimals)} ${units[unitIndex]}`
}

const formatSpeed = (bytesPerSecond: number): string => {
  if (bytesPerSecond < 1024) return `${bytesPerSecond.toFixed(0)} B/s`
  if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`
  return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`
}

const formatETA = (seconds: number): string => {
  if (seconds < 60) return `${Math.ceil(seconds)}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.ceil(seconds % 60)}s`
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${hours}h ${minutes}m`
}

export const ModelCard: FC<ModelCardProps> = ({
  model,
  isDownloaded,
  downloadProgress,
  onDownload,
  onDelete,
  onPause,
  onResume,
  onCancel,
  className
}) => {
  const tierInfo = tierConfig[model.hardwareTier]
  const isDownloading = downloadProgress?.status === 'downloading'
  const isPaused = downloadProgress?.status === 'paused'
  const hasError = downloadProgress?.status === 'error'
  const isInProgress = isDownloading || isPaused

  const handleDownload = (): void => {
    onDownload(model.id)
  }

  const handleDelete = (): void => {
    onDelete(model.id)
  }

  const handlePause = (): void => {
    onPause?.(model.id)
  }

  const handleResume = (): void => {
    onResume?.(model.id)
  }

  const handleCancel = (): void => {
    onCancel?.(model.id)
  }

  return (
    <Card className={cn('relative overflow-hidden', className)}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="text-base">{model.name}</CardTitle>
            <CardDescription className="text-xs">{model.description}</CardDescription>
          </div>
          <Badge className={tierInfo.className}>{tierInfo.label}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Model Info */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{formatSize(model.sizeBytes)}</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-sm text-muted-foreground">{model.quantization}</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-sm text-muted-foreground">
            {model.contextLength.toLocaleString()} ctx
          </span>
        </div>

        {/* Capabilities */}
        <div className="flex flex-wrap gap-1.5">
          {model.capabilities.map((capability) => {
            const config = capabilityConfig[capability]
            const Icon = config.icon
            return (
              <Badge key={capability} variant="secondary" className="gap-1 text-xs">
                <Icon className="size-3" />
                {config.label}
              </Badge>
            )
          })}
        </div>

        {/* Download Progress */}
        {isInProgress && downloadProgress && (
          <div className="space-y-2">
            <Progress
              value={downloadProgress.percentage}
              className="h-2 transition-all duration-300 ease-out"
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{downloadProgress.percentage.toFixed(1)}%</span>
              <div className="flex items-center gap-2">
                {isDownloading && (
                  <>
                    <span>{formatSpeed(downloadProgress.speed)}</span>
                    <span>·</span>
                    <span>ETA: {formatETA(downloadProgress.eta)}</span>
                  </>
                )}
                {isPaused && <span>Paused</span>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isDownloading ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePause}
                  disabled={!onPause}
                  className="flex-1"
                >
                  <Pause className="size-4" />
                  Pause
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleResume}
                  disabled={!onResume}
                  className="flex-1"
                >
                  <Play className="size-4" />
                  Resume
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancel}
                disabled={!onCancel}
                className="text-destructive hover:text-destructive"
              >
                <X className="size-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Error State */}
        {hasError && downloadProgress && (
          <div className="space-y-2">
            <p className="text-sm text-destructive">
              {downloadProgress.error || 'Download failed'}
            </p>
            <Button variant="outline" size="sm" onClick={handleDownload} className="w-full">
              <Download className="size-4" />
              Retry Download
            </Button>
          </div>
        )}

        {/* Actions */}
        {!isInProgress && !hasError && (
          <div className="flex items-center gap-2">
            {isDownloaded ? (
              <>
                <Badge
                  variant="outline"
                  className="gap-1 bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/20"
                >
                  <CheckCircle2 className="size-3" />
                  Downloaded
                </Badge>
                <div className="flex-1" />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDelete}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="size-4" />
                  Delete
                </Button>
              </>
            ) : (
              <Button variant="default" size="sm" onClick={handleDownload} className="w-full">
                <Download className="size-4" />
                Download
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
