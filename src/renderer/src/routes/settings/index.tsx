import { type FC, type ReactNode, useMemo } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  Bot,
  Search,
  Download,
  Trash2,
  CheckCircle2,
  Pause,
  Play,
  X,
  Mic,
  Users
} from 'lucide-react'
import { Card, CardContent } from '@renderer/components/ui/card'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Progress } from '@renderer/components/ui/progress'
import { Switch } from '@renderer/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { useAvailableModels } from '@renderer/hooks/useHardware'
import { useDownloadedModels, useModelDownload, useDeleteModel } from '@renderer/hooks/useModels'
import { useConfig, useSetConfig } from '@renderer/hooks/useConfig'
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

const TRANSCRIPTION_MODEL_ROWS: ModelRowConfig[] = [
  { id: 'whisper-base-onnx', label: 'Transcription', icon: Mic },
  { id: 'whisper-small-onnx', label: 'Transcription', icon: Mic },
  { id: 'whisper-large-v3-turbo-onnx', label: 'Transcription', icon: Mic }
]

const DIARIZATION_MODEL_ROWS: ModelRowConfig[] = [
  { id: 'sherpa-onnx-pyannote-segmentation', label: 'Diarization', icon: Users },
  { id: 'sherpa-onnx-3dspeaker-embedding', label: 'Diarization', icon: Users }
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

      <MeetingModelsSection
        modelsMap={modelsMap}
        downloadedModelIds={downloadedModelIds}
        progress={progress}
        onDownload={download}
        onDelete={(id) => deleteModel.mutate(id)}
        onPause={pause}
        onResume={resume}
        onCancel={cancel}
      />

      <MeetingNotesSettings downloadedModels={downloadedModels ?? []} />
    </div>
  )
}

interface MeetingModelsSectionProps {
  modelsMap: Map<string, ModelDefinition>
  downloadedModelIds: Set<string>
  progress: Map<string, DownloadProgress>
  onDownload: (id: string) => void
  onDelete: (id: string) => void
  onPause: (id: string) => void
  onResume: (id: string) => void
  onCancel: (id: string) => void
}

const MeetingModelsSection: FC<MeetingModelsSectionProps> = ({
  modelsMap,
  downloadedModelIds,
  progress,
  onDownload,
  onDelete,
  onPause,
  onResume,
  onCancel
}) => {
  const renderModelRows = (rows: ModelRowConfig[]): ReactNode =>
    rows.map((row) => {
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
          onDownload={onDownload}
          onDelete={onDelete}
          onPause={onPause}
          onResume={onResume}
          onCancel={onCancel}
        />
      )
    })

  return (
    <div className="mt-8">
      <div className="mb-4 flex items-center gap-2">
        <Mic className="size-5 text-muted-foreground" />
        <div>
          <h2 className="text-lg font-semibold">Meeting Note Models</h2>
          <p className="text-xs text-muted-foreground">
            Models required for meeting transcription and speaker identification.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <p className="mb-2 text-sm font-medium text-muted-foreground">
            Transcription (choose one)
          </p>
          <div className="space-y-3">{renderModelRows(TRANSCRIPTION_MODEL_ROWS)}</div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-muted-foreground">Speaker Identification</p>
          <div className="space-y-3">{renderModelRows(DIARIZATION_MODEL_ROWS)}</div>
        </div>
      </div>
    </div>
  )
}

interface MeetingNotesSettingsProps {
  downloadedModels: ModelDefinition[]
}

const MeetingNotesSettings: FC<MeetingNotesSettingsProps> = ({ downloadedModels }) => {
  const { data: meetingConfig } = useConfig('meeting')
  const setConfig = useSetConfig<'meeting'>()

  const whisperModels = useMemo(
    () => downloadedModels.filter((m) => m.capabilities.includes('transcription')),
    [downloadedModels]
  )

  if (!meetingConfig) return null

  const handleKeepAudioChange = (checked: boolean): void => {
    setConfig.mutate({
      key: 'meeting',
      value: { ...meetingConfig, keepAudioAfterTranscription: checked }
    })
  }

  const handleRecordingModeChange = (value: string): void => {
    setConfig.mutate({
      key: 'meeting',
      value: { ...meetingConfig, defaultRecordingMode: value as 'remote' | 'in-person' }
    })
  }

  const handleWhisperModelChange = (value: string): void => {
    setConfig.mutate({ key: 'meeting', value: { ...meetingConfig, whisperModelId: value } })
  }

  return (
    <div className="mt-8">
      <div className="mb-4 flex items-center gap-2">
        <Mic className="size-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Meeting Notes</h2>
      </div>
      <Card>
        <CardContent className="divide-y py-0">
          {/* Keep audio toggle */}
          <div className="flex items-center justify-between py-4">
            <div className="flex-1 pr-4">
              <p className="text-sm font-medium">Keep audio recordings after transcription</p>
              <p className="text-xs text-muted-foreground">
                Preserve the original audio files once transcription is complete
              </p>
            </div>
            <Switch
              checked={meetingConfig.keepAudioAfterTranscription}
              onCheckedChange={handleKeepAudioChange}
            />
          </div>

          {/* Default recording mode */}
          <div className="flex items-center justify-between py-4">
            <div className="flex-1 pr-4">
              <p className="text-sm font-medium">Default recording mode</p>
              <p className="text-xs text-muted-foreground">
                Remote captures mic + system audio; In-person captures mic only
              </p>
            </div>
            <Select
              value={meetingConfig.defaultRecordingMode}
              onValueChange={handleRecordingModeChange}
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="remote">Remote</SelectItem>
                <SelectItem value="in-person">In-person</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Transcription model */}
          <div className="flex items-center justify-between py-4">
            <div className="flex-1 pr-4">
              <p className="text-sm font-medium">Transcription model</p>
              <p className="text-xs text-muted-foreground">
                {whisperModels.length === 0
                  ? 'No transcription models downloaded yet'
                  : 'Whisper model used for meeting transcription'}
              </p>
            </div>
            <Select
              value={meetingConfig.whisperModelId}
              onValueChange={handleWhisperModelChange}
              disabled={whisperModels.length === 0}
            >
              <SelectTrigger className="w-52">
                <SelectValue placeholder="No model available" />
              </SelectTrigger>
              <SelectContent>
                {whisperModels.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
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
