import { type FC, type ReactNode, useMemo } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Bot, Search, Download, Trash2, CheckCircle2, Pause, Play, X } from 'lucide-react'
import { Card, CardContent } from '@renderer/components/ui/card'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Progress } from '@renderer/components/ui/progress'
import { useAvailableModels } from '@renderer/hooks/useHardware'
import { useDownloadedModels, useModelDownload, useDeleteModel } from '@renderer/hooks/useModels'
import { formatSize, formatSpeed, formatETA } from '@renderer/lib/format'
import type { ModelDefinition, DownloadProgress } from '@main/ai/types'

export const Route = createFileRoute('/settings/')({
  component: SettingsPage
})

interface ModelRowConfig {
  id: string
  label: string
  icon: FC<{ className?: string }>
}

const MODEL_ROWS: ModelRowConfig[] = [
  { id: 'qwen3-4b-instruct-2507-q8', label: 'AI Chat', icon: Bot },
  { id: 'nomic-embed-text-v2-moe', label: 'Search', icon: Search }
]

function SettingsPage(): ReactNode {
  const { data: availableModels } = useAvailableModels()
  const { data: downloadedModels } = useDownloadedModels()
  const { progress, download, pause, resume, cancel } = useModelDownload()
  const deleteModel = useDeleteModel()

  const downloadedModelIds = useMemo(
    () => new Set(downloadedModels?.map((m) => m.id) ?? []),
    [downloadedModels]
  )

  const modelsMap = useMemo(() => {
    const map = new Map<string, ModelDefinition>()
    for (const m of availableModels ?? []) map.set(m.id, m)
    return map
  }, [availableModels])

  return (
    <div className="flex w-full max-w-2xl flex-col mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage your AI models for local chat and semantic search.
        </p>
      </div>

      <div className="space-y-3">
        {MODEL_ROWS.map((row) => {
          const model = modelsMap.get(row.id)
          if (!model) return null
          return (
            <ModelRow
              key={row.id}
              model={model}
              label={row.label}
              icon={row.icon}
              isDownloaded={downloadedModelIds.has(row.id)}
              downloadProgress={progress.get(row.id)}
              onDownload={download}
              onDelete={(id) => deleteModel.mutate(id)}
              onPause={pause}
              onResume={resume}
              onCancel={cancel}
            />
          )
        })}
      </div>
    </div>
  )
}

interface ModelRowProps {
  model: ModelDefinition
  label: string
  icon: FC<{ className?: string }>
  isDownloaded: boolean
  downloadProgress?: DownloadProgress
  onDownload: (id: string) => void
  onDelete: (id: string) => void
  onPause: (id: string) => void
  onResume: (id: string) => void
  onCancel: (id: string) => void
}

const ModelRow: FC<ModelRowProps> = ({
  model,
  label,
  icon: Icon,
  isDownloaded,
  downloadProgress,
  onDownload,
  onDelete,
  onPause,
  onResume,
  onCancel
}) => {
  const isDownloading = downloadProgress?.status === 'downloading'
  const isPaused = downloadProgress?.status === 'paused'
  const hasError = downloadProgress?.status === 'error'
  const isInProgress = isDownloading || isPaused

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        {/* Top row: icon + info */}
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Icon className="size-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{model.name}</span>
              <Badge variant="outline" className="shrink-0 text-[10px]">
                {label}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">{formatSize(model.sizeBytes)}</p>
          </div>
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
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs text-destructive hover:text-destructive"
                onClick={() => onCancel(model.id)}
              >
                <X className="size-3" />
                Cancel
              </Button>
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
          ) : (
            <Button
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => onDownload(model.id)}
            >
              <Download className="size-3" />
              Download
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
