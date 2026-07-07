import { type FC, type ReactNode, useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTheme } from 'next-themes'
import {
  Search,
  Download,
  Trash2,
  CheckCircle2,
  Pause,
  Play,
  X,
  Mic,
  Palette,
  Monitor,
  Sun,
  Moon,
  ChevronDown,
  Cpu,
  Boxes
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
import { useModelProfile } from '@renderer/hooks/useHardware'
import { useDownloadedModels, useModelDownload, useDeleteModel } from '@renderer/hooks/useModels'
import { useConfig, useSetConfig } from '@renderer/hooks/useConfig'
import { formatSize, formatSpeed, formatETA } from '@renderer/lib/format'
import {
  FEATURES,
  resolveFeatureModels,
  resolveFeatureAlternatives,
  computeFeatureProgress,
  type CuratedFeature
} from '@renderer/lib/modelFeatures'
import type { ModelDefinition, DownloadProgress, ModelProfile } from '@main/ai/types'

export const Route = createFileRoute('/settings/')({
  component: SettingsPage
})

interface ResolvedFeature {
  feature: CuratedFeature
  recommended: ModelDefinition[]
  alternatives: ModelDefinition[]
}

function SettingsPage(): ReactNode {
  const { data: profile, isLoading: isLoadingProfile } = useModelProfile()
  const { data: downloadedModels } = useDownloadedModels()
  const { progress, download, pause, resume, cancel } = useModelDownload()
  const deleteModel = useDeleteModel()

  const downloadedModelIds = useMemo(
    () => new Set(downloadedModels?.map((m) => m.id) ?? []),
    [downloadedModels]
  )

  const compatibleModelIds = useMemo(
    () => new Set(profile?.compatibleModels.map((m) => m.id) ?? []),
    [profile]
  )

  const resolvedFeatures = useMemo<ResolvedFeature[]>(() => {
    if (!profile) return []
    return FEATURES.map((feature) => ({
      feature,
      recommended: resolveFeatureModels(profile, feature.key),
      alternatives: resolveFeatureAlternatives(profile, feature.key)
    }))
  }, [profile])

  if (isLoadingProfile || !profile) {
    return (
      <div className="flex w-full max-w-2xl flex-col mx-auto">
        <div className="mb-6">
          <h1 className="font-serif text-4xl font-normal tracking-tight">Settings</h1>
          <p className="text-muted-foreground">Loading hardware profile…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex w-full max-w-2xl flex-col mx-auto">
      <div className="mb-6">
        <h1 className="font-serif text-4xl font-normal tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Customize appearance and manage your local AI models.
        </p>
      </div>

      <HardwareBanner profile={profile} />

      <div className="mb-4 flex items-center gap-2">
        <Boxes className="size-5 text-muted-foreground" />
        <div>
          <h2 className="text-lg font-semibold">AI Models</h2>
          <p className="text-xs text-muted-foreground">
            Local models powering chat, search and meeting notes. Open “Show details” to manage
            individual files or download alternative variants.
          </p>
        </div>
      </div>

      <div className="grid gap-4">
        {resolvedFeatures.map((rf) => (
          <ModelFeatureCard
            key={rf.feature.key}
            resolved={rf}
            downloadedModelIds={downloadedModelIds}
            progress={progress}
            onDownload={download}
            onDelete={(id) => deleteModel.mutate(id)}
            onPause={pause}
            onResume={resume}
            onCancel={cancel}
          />
        ))}
      </div>

      <SearchSettings />

      <MeetingNotesSettings
        downloadedModels={downloadedModels ?? []}
        compatibleModelIds={compatibleModelIds}
        supportsRealtimeAsr={profile.supportsRealtimeAsr}
      />

      <AppearanceSettings />
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
      <Card className="py-0">
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

const formatRamGb = (bytes: number): string => {
  const gb = bytes / (1024 * 1024 * 1024)
  return `${Math.round(gb)} GB`
}

const formatTierLabel = (tier: string): string => tier.charAt(0).toUpperCase() + tier.slice(1)

const HardwareBanner: FC<{ profile: ModelProfile }> = ({ profile }) => {
  const { hardware } = profile
  const ramLabel = formatRamGb(hardware.memory.totalBytes)
  const cpuLabel = hardware.cpu.brand.trim() || 'Unknown CPU'
  const gpuLabel =
    hardware.gpu.name !== 'Unknown' ? hardware.gpu.name : 'Integrated / no discrete GPU'

  return (
    <Card className="mb-6 py-0">
      <CardContent className="flex items-start gap-3 py-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Cpu className="size-4 text-primary" />
        </div>
        <div className="min-w-0 text-left">
          <p className="text-sm font-medium">
            Detected: {formatTierLabel(hardware.tier)} tier · {ramLabel} RAM
          </p>
          <p className="text-xs text-muted-foreground">
            {cpuLabel} · {gpuLabel}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Models below are selected for your hardware. Incompatible variants are hidden.
          </p>
        </div>
      </CardContent>
    </Card>
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
    <div className="mt-8">
      <div className="mb-4 flex items-center gap-2">
        <Palette className="size-5 text-muted-foreground" />
        <div>
          <h2 className="text-lg font-semibold">Appearance</h2>
          <p className="text-xs text-muted-foreground">
            Choose how TaacNotes looks on your device.
          </p>
        </div>
      </div>

      <Card className="py-0">
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

/**
 * Short capability label shown as a badge next to each model in a feature card.
 */
const modelLabel = (model: ModelDefinition): string => {
  const caps = model.capabilities
  if (caps.includes('chat')) return 'Chat'
  if (caps.includes('embedding')) return 'Search'
  if (caps.includes('reranking')) return 'Reranker'
  if (caps.includes('transcription')) return model.format === 'mlx' ? 'Realtime' : 'Transcription'
  if (caps.includes('vad')) return 'Voice activity'
  if (caps.includes('diarization')) return 'Diarization'
  return 'Model'
}

interface ModelFeatureCardProps {
  resolved: ResolvedFeature
  downloadedModelIds: Set<string>
  progress: Map<string, DownloadProgress>
  onDownload: (id: string) => void
  onDelete: (id: string) => void
  onPause: (id: string) => void
  onResume: (id: string) => void
  onCancel: (id: string) => void
}

/**
 * Feature-grouped card mirroring the onboarding UX: shows the aggregate status
 * of a feature bundle, hides the individual models behind a "Show details"
 * accordion, and nests the non-recommended (more/less powerful) variants behind
 * a further "Advanced" toggle.
 */
const ModelFeatureCard: FC<ModelFeatureCardProps> = ({
  resolved,
  downloadedModelIds,
  progress,
  onDownload,
  onDelete,
  onPause,
  onResume,
  onCancel
}) => {
  const { feature, recommended, alternatives } = resolved
  const Icon = feature.icon
  const [detailsOpen, setDetailsOpen] = useState(false)

  const isComplete = (id: string): boolean =>
    downloadedModelIds.has(id) || progress.get(id)?.status === 'completed'

  const allComplete = recommended.length > 0 && recommended.every((m) => isComplete(m.id))
  const missingIds = recommended.filter((m) => !isComplete(m.id)).map((m) => m.id)

  const agg = useMemo(
    () => computeFeatureProgress(recommended, progress, isComplete),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recommended, progress, downloadedModelIds]
  )
  const isDownloading = agg.activeStatus !== null

  const renderRow = (model: ModelDefinition): ReactNode => (
    <ModelRow
      key={model.id}
      model={model}
      label={modelLabel(model)}
      icon={Icon}
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
                <Badge variant="secondary" className="text-xs">
                  Recommended for your hardware
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">{feature.description}</p>
            </div>
          </div>

          <div className="shrink-0">
            {allComplete ? (
              <Badge variant="secondary" className="gap-1">
                <CheckCircle2 className="size-3" />
                Ready
              </Badge>
            ) : !isDownloading ? (
              <Button
                size="sm"
                variant={feature.optional ? 'outline' : 'default'}
                onClick={() => missingIds.forEach(onDownload)}
              >
                <Download className="size-3.5" />
                Download
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
                {agg.activeStatus === 'pending' && ' · Preparing...'}
              </span>
              <span>{Math.round(agg.percentage)}%</span>
            </div>
          </div>
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
            <AdvancedModels label="more/less powerful models">
              {alternatives.map(renderRow)}
            </AdvancedModels>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
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
      <CollapsibleContent className="mt-2 space-y-2">{items}</CollapsibleContent>
    </Collapsible>
  )
}

interface MeetingNotesSettingsProps {
  downloadedModels: ModelDefinition[]
  compatibleModelIds: Set<string>
  supportsRealtimeAsr: boolean
}

const MeetingNotesSettings: FC<MeetingNotesSettingsProps> = ({
  downloadedModels,
  compatibleModelIds,
  supportsRealtimeAsr
}) => {
  const { data: meetingConfig } = useConfig('meeting')
  const setConfig = useSetConfig<'meeting'>()

  const whisperModels = useMemo(
    () =>
      downloadedModels.filter(
        (m) =>
          compatibleModelIds.has(m.id) &&
          m.capabilities.includes('transcription') &&
          m.format === 'ggml'
      ),
    [downloadedModels, compatibleModelIds]
  )

  const realtimeAsrModels = useMemo(
    () =>
      downloadedModels.filter(
        (m) =>
          compatibleModelIds.has(m.id) &&
          m.capabilities.includes('transcription') &&
          m.format === 'mlx'
      ),
    [downloadedModels, compatibleModelIds]
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

  return (
    <div className="mt-8">
      <div className="mb-4 flex items-center gap-2">
        <Mic className="size-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Meeting Notes</h2>
      </div>
      <Card className="py-0">
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

          {/* Realtime transcription (Apple Silicon macOS only) */}
          {supportsRealtimeAsr && (
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
          <Button size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => onDownload(model.id)}>
            <Download className="size-3" />
            Download
          </Button>
        )}
      </div>
    </div>
  )
}
