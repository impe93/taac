import { type FC, type ReactNode, useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTheme } from 'next-themes'
import {
  Bot,
  Search,
  ArrowUpDown,
  Download,
  Trash2,
  CheckCircle2,
  Pause,
  Play,
  X,
  Mic,
  Users,
  Palette,
  Monitor,
  Sun,
  Moon,
  ChevronDown
} from 'lucide-react'
import { Card, CardContent } from '@renderer/components/ui/card'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Progress } from '@renderer/components/ui/progress'
import { Switch } from '@renderer/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@renderer/components/ui/collapsible'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { useAvailableModels, useHardwareInfo } from '@renderer/hooks/useHardware'
import { useDownloadedModels, useModelDownload, useDeleteModel } from '@renderer/hooks/useModels'
import { useConfig, useSetConfig } from '@renderer/hooks/useConfig'
import { formatSize, formatSpeed, formatETA } from '@renderer/lib/format'
import { getWhisperChoice, getAsrChoice, type ModelChoice } from '@renderer/lib/modelSelection'
import type { ModelDefinition, DownloadProgress, HardwareTier } from '@main/ai/types'

export const Route = createFileRoute('/settings/')({
  component: SettingsPage
})

interface ModelRowConfig {
  id: string
  label: string
  icon: FC<{ className?: string }>
}

const MODEL_ROWS: ModelRowConfig[] = [
  { id: 'qwen3-5-2b-q8', label: 'AI Chat', icon: Bot },
  { id: 'embeddinggemma-300m-q8', label: 'Search', icon: Search },
  { id: 'qwen3-reranker-0.6b-q8', label: 'Reranker', icon: ArrowUpDown }
]

// Speaker identification always needs segmentation + one embedding model.
const DIARIZATION_MODEL_IDS = [
  'sherpa-onnx-pyannote-segmentation',
  'sherpa-onnx-nemo-titanet-small'
]

function SettingsPage(): ReactNode {
  const { data: availableModels } = useAvailableModels()
  const { data: downloadedModels } = useDownloadedModels()
  const { data: hardwareInfo } = useHardwareInfo()
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

  const tier: HardwareTier = hardwareInfo?.tier ?? 'low'
  // Realtime ASR (Qwen3-ASR via MLX) runs on macOS Apple Silicon only.
  const supportsRealtimeAsr =
    window.platform === 'darwin' && !!hardwareInfo?.cpu.brand.includes('Apple')

  // Resolve the optimal transcription/ASR variant for this machine, with
  // compatible alternatives surfaced behind an "Advanced" toggle.
  const whisperChoice = useMemo(
    () => getWhisperChoice(availableModels ?? [], tier),
    [availableModels, tier]
  )
  const asrChoice = useMemo(
    () => (supportsRealtimeAsr ? getAsrChoice(availableModels ?? [], tier) : null),
    [availableModels, tier, supportsRealtimeAsr]
  )
  const vadModel = modelsMap.get('silero-vad-onnx')
  const diarizationModels = useMemo(
    () =>
      DIARIZATION_MODEL_IDS.map((id) => modelsMap.get(id)).filter((m): m is ModelDefinition => !!m),
    [modelsMap]
  )

  return (
    <div className="flex w-full max-w-2xl flex-col mx-auto">
      <div className="mb-6">
        <h1 className="font-serif text-4xl font-normal tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Customize appearance and manage your local AI models.
        </p>
      </div>

      <AppearanceSettings />

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

      <SearchSettings />

      <MeetingModelsSection
        whisperChoice={whisperChoice}
        asrChoice={asrChoice}
        vadModel={supportsRealtimeAsr ? vadModel : undefined}
        diarizationModels={diarizationModels}
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

/**
 * Search & Retrieval settings — toggle for opt-in contextual retrieval.
 */
const SearchSettings: FC = () => {
  const { data: contextualEnabled } = useConfig('contextualRetrievalEnabled')
  const setConfig = useSetConfig<'contextualRetrievalEnabled'>()

  const handleContextualChange = (checked: boolean): void => {
    setConfig.mutate({ key: 'contextualRetrievalEnabled', value: checked })
  }

  return (
    <div className="mt-8">
      <div className="mb-4 flex items-center gap-2">
        <Search className="size-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Search &amp; Retrieval</h2>
      </div>
      <Card>
        <CardContent className="divide-y py-0">
          <div className="flex items-center justify-between py-4">
            <div className="flex-1 pr-4">
              <p className="text-sm font-medium">Contextual retrieval</p>
              <p className="text-xs text-muted-foreground">
                Use the local AI to add a short context to each note chunk for sharper search
                results. Improves accuracy on longer notes but makes indexing noticeably slower.
                Changing this re-indexes your notes.
              </p>
            </div>
            <Switch checked={contextualEnabled ?? false} onCheckedChange={handleContextualChange} />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

const THEME_OPTIONS = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon }
] as const

const AppearanceSettings: FC = () => {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  // next-themes resolves the theme only on the client; avoid a flash/mismatch
  useEffect(() => {
    setMounted(true)
  }, [])

  const currentTheme = mounted ? (theme ?? 'system') : 'system'

  return (
    <div className="mb-8">
      <div className="mb-4 flex items-center gap-2">
        <Palette className="size-5 text-muted-foreground" />
        <div>
          <h2 className="text-lg font-semibold">Appearance</h2>
          <p className="text-xs text-muted-foreground">
            Choose how TaacNotes looks on your device.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="flex items-center justify-between gap-4 py-4">
          <div>
            <p className="text-sm font-medium">Theme</p>
            <p className="text-xs text-muted-foreground">
              System matches your operating system appearance.
            </p>
          </div>
          <ToggleGroup
            type="single"
            value={currentTheme}
            onValueChange={(value) => value && setTheme(value)}
            variant="outline"
            size="sm"
          >
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
              <ToggleGroupItem
                key={value}
                value={value}
                aria-label={`${label} theme`}
                className="gap-1.5 px-3 data-[state=on]:text-primary"
              >
                <Icon className="size-4" />
                <span className="text-xs">{label}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </CardContent>
      </Card>
    </div>
  )
}

interface MeetingModelsSectionProps {
  /** Optimal Whisper (GGML) variant for this machine, plus compatible alternatives. */
  whisperChoice: ModelChoice | null
  /** Optimal realtime ASR (MLX) variant — only on Apple Silicon, otherwise null. */
  asrChoice: ModelChoice | null
  /** Voice-activity-detection dependency for realtime ASR (undefined when unsupported). */
  vadModel: ModelDefinition | undefined
  /** Speaker-identification models (segmentation + embedding). */
  diarizationModels: ModelDefinition[]
  downloadedModelIds: Set<string>
  progress: Map<string, DownloadProgress>
  onDownload: (id: string) => void
  onDelete: (id: string) => void
  onPause: (id: string) => void
  onResume: (id: string) => void
  onCancel: (id: string) => void
}

const MeetingModelsSection: FC<MeetingModelsSectionProps> = ({
  whisperChoice,
  asrChoice,
  vadModel,
  diarizationModels,
  downloadedModelIds,
  progress,
  onDownload,
  onDelete,
  onPause,
  onResume,
  onCancel
}) => {
  const renderRow = (
    model: ModelDefinition,
    label: string,
    icon: FC<{ className?: string }>
  ): ReactNode => (
    <ModelRow
      key={model.id}
      model={model}
      label={label}
      icon={icon}
      isDownloaded={downloadedModelIds.has(model.id)}
      downloadProgress={progress.get(model.id)}
      onDownload={onDownload}
      onDelete={onDelete}
      onPause={onPause}
      onResume={onResume}
      onCancel={onCancel}
    />
  )

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
        {whisperChoice && (
          <div>
            <p className="mb-2 text-sm font-medium text-muted-foreground">
              Transcription (recommended for your hardware)
            </p>
            <div className="space-y-3">
              {renderRow(whisperChoice.optimal, 'Transcription', Mic)}
            </div>
            <AdvancedModels label="other transcription models">
              {whisperChoice.alternatives.map((m) => renderRow(m, 'Transcription', Mic))}
            </AdvancedModels>
          </div>
        )}

        {asrChoice && (
          <div>
            <p className="mb-2 text-sm font-medium text-muted-foreground">
              Realtime transcription (macOS — live transcript while recording)
            </p>
            <div className="space-y-3">
              {renderRow(asrChoice.optimal, 'Realtime', Mic)}
              {vadModel && renderRow(vadModel, 'Voice activity detection', Mic)}
            </div>
            <AdvancedModels label="other realtime models">
              {asrChoice.alternatives.map((m) => renderRow(m, 'Realtime', Mic))}
            </AdvancedModels>
          </div>
        )}

        {diarizationModels.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium text-muted-foreground">
              Speaker Identification (segmentation + embedding)
            </p>
            <div className="space-y-3">
              {diarizationModels.map((m) => renderRow(m, 'Diarization', Users))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Collapsible container for non-optimal but compatible model variants.
 * Renders nothing when there are no alternatives to show.
 */
const AdvancedModels: FC<{ label: string; children: ReactNode }> = ({ label, children }) => {
  const [open, setOpen] = useState(false)
  const items = Array.isArray(children) ? children.filter(Boolean) : children
  if (Array.isArray(items) && items.length === 0) return null

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-2">
      <CollapsibleTrigger className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ChevronDown className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        {open ? `Hide ${label}` : `Show ${label}`}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-3">{items}</CollapsibleContent>
    </Collapsible>
  )
}

interface MeetingNotesSettingsProps {
  downloadedModels: ModelDefinition[]
}

const MeetingNotesSettings: FC<MeetingNotesSettingsProps> = ({ downloadedModels }) => {
  const { data: meetingConfig } = useConfig('meeting')
  const setConfig = useSetConfig<'meeting'>()

  const whisperModels = useMemo(
    () =>
      downloadedModels.filter(
        (m) => m.capabilities.includes('transcription') && m.format === 'ggml'
      ),
    [downloadedModels]
  )

  const realtimeAsrModels = useMemo(
    () =>
      downloadedModels.filter(
        (m) => m.capabilities.includes('transcription') && m.format === 'mlx'
      ),
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

  const handleRealtimeTranscriptionChange = (checked: boolean): void => {
    setConfig.mutate({
      key: 'meeting',
      value: { ...meetingConfig, realtimeTranscription: checked ? 'auto' : 'off' }
    })
  }

  const handleAsrModelChange = (value: string): void => {
    setConfig.mutate({ key: 'meeting', value: { ...meetingConfig, asrModelId: value } })
  }

  const isMac = window.platform === 'darwin'

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

          {/* Realtime transcription (macOS Apple Silicon only) */}
          {isMac && (
            <>
              <div className="flex items-center justify-between py-4">
                <div className="flex-1 pr-4">
                  <p className="text-sm font-medium">Realtime transcription</p>
                  <p className="text-xs text-muted-foreground">
                    Transcribe live while recording (Apple Silicon, macOS 15+). When off or
                    unavailable, the transcript is generated after the meeting ends.
                  </p>
                </div>
                <Switch
                  checked={meetingConfig.realtimeTranscription !== 'off'}
                  onCheckedChange={handleRealtimeTranscriptionChange}
                />
              </div>

              <div className="flex items-center justify-between py-4">
                <div className="flex-1 pr-4">
                  <p className="text-sm font-medium">Realtime transcription model</p>
                  <p className="text-xs text-muted-foreground">
                    {realtimeAsrModels.length === 0
                      ? 'No realtime models downloaded yet'
                      : 'Qwen3-ASR model used for live transcription'}
                  </p>
                </div>
                <Select
                  value={meetingConfig.asrModelId}
                  onValueChange={handleAsrModelChange}
                  disabled={
                    realtimeAsrModels.length === 0 || meetingConfig.realtimeTranscription === 'off'
                  }
                >
                  <SelectTrigger className="w-52">
                    <SelectValue placeholder="No model available" />
                  </SelectTrigger>
                  <SelectContent>
                    {realtimeAsrModels.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
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
