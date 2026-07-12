import { type FC, type ReactNode, useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTheme } from 'next-themes'
import {
  Search,
  Mic,
  Palette,
  Monitor,
  Sun,
  Moon,
  Cpu,
  Boxes,
  Loader2,
  RefreshCw
} from 'lucide-react'
import { Card, CardContent } from '@renderer/components/ui/card'
import { Button } from '@renderer/components/ui/button'
import { Switch } from '@renderer/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group'
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
import { useIndexAllSpaces } from '@renderer/hooks/useVectorSearch'
import { ModelFeatureCard } from '@renderer/components/models/ModelFeatureCard'
import {
  FEATURES,
  resolveFeatureModels,
  resolveFeatureAlternatives,
  type CuratedFeature
} from '@renderer/lib/modelFeatures'
import type { ModelDefinition, ModelProfile } from '@main/ai/types'
import {
  SUMMARY_DEPTH_OPTIONS,
  isDetailedSummaryAvailable,
  detailedUnavailableReason,
  resolveSelectableDepth,
  type SummaryDepth
} from '@renderer/lib/meetingSummary'

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
            feature={rf.feature}
            recommended={rf.recommended}
            alternatives={rf.alternatives}
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
        profile={profile}
      />

      <AppearanceSettings />
    </div>
  )
}

/** Options for the automatic batch-indexing interval (minutes). 0 = off. */
const INDEXING_INTERVAL_OPTIONS = [
  { value: 0, label: 'Off (manual only)' },
  { value: 5, label: 'Every 5 minutes' },
  { value: 10, label: 'Every 10 minutes' },
  { value: 15, label: 'Every 15 minutes' },
  { value: 30, label: 'Every 30 minutes' },
  { value: 60, label: 'Every hour' },
  { value: 120, label: 'Every 2 hours' }
] as const

/**
 * Search & Retrieval settings — batch indexing schedule + manual cross-space
 * re-index, plus toggles for contextual retrieval and multi-search.
 */
const SearchSettings: FC = () => {
  const { data: contextualEnabled } = useConfig('contextualRetrievalEnabled')
  const setContextualConfig = useSetConfig<'contextualRetrievalEnabled'>()
  const { data: ragMultiSearch } = useConfig('ragMultiSearch')
  const setMultiSearchConfig = useSetConfig<'ragMultiSearch'>()
  const { data: indexingInterval } = useConfig('indexingIntervalMinutes')
  const setIndexingInterval = useSetConfig<'indexingIntervalMinutes'>()
  const { indexAllSpaces, isIndexing, progress } = useIndexAllSpaces()

  const handleContextualChange = (checked: boolean): void => {
    setContextualConfig.mutate({ key: 'contextualRetrievalEnabled', value: checked })
  }

  const handleMultiSearchChange = (checked: boolean): void => {
    setMultiSearchConfig.mutate({ key: 'ragMultiSearch', value: checked })
  }

  const handleIntervalChange = (value: string): void => {
    setIndexingInterval.mutate({ key: 'indexingIntervalMinutes', value: Number(value) })
  }

  const indexButtonLabel = ((): string => {
    if (!isIndexing) return 'Index all notes'
    if (!progress) return 'Starting…'
    const space = `Space ${progress.spaceIndex + 1}/${progress.spaceTotal}`
    if (progress.status === 'checking') return `${space} · checking`
    return `${space} · ${progress.current}/${progress.total}`
  })()

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
              <p className="text-sm font-medium">Automatic indexing</p>
              <p className="text-xs text-muted-foreground">
                Your notes are indexed for search in the background on a schedule instead of while
                you type — keeping the CPU and GPU idle as you write. Recently edited notes become
                searchable after the next run. Choose &quot;Off&quot; to only index manually.
              </p>
            </div>
            <Select value={String(indexingInterval ?? 30)} onValueChange={handleIntervalChange}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INDEXING_INTERVAL_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={String(opt.value)}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between py-4">
            <div className="flex-1 pr-4">
              <p className="text-sm font-medium">Index all notes now</p>
              <p className="text-xs text-muted-foreground">
                Re-index every note across all spaces immediately. Only notes that changed since the
                last run are re-embedded, so this is safe to run anytime.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => indexAllSpaces()}
              disabled={isIndexing}
            >
              {isIndexing ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 size-4" />
              )}
              {indexButtonLabel}
            </Button>
          </div>
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
          <div className="flex items-center justify-between py-4">
            <div className="flex-1 pr-4">
              <p className="text-sm font-medium">Multiple note searches per message</p>
              <p className="text-xs text-muted-foreground">
                Let the chat assistant run several note searches to refine an answer. Turn off to
                cap it to a single search per message — faster and lighter on lower-end devices.
              </p>
            </div>
            <Switch checked={ragMultiSearch ?? true} onCheckedChange={handleMultiSearchChange} />
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

interface MeetingNotesSettingsProps {
  downloadedModels: ModelDefinition[]
  compatibleModelIds: Set<string>
  supportsRealtimeAsr: boolean
  profile: ModelProfile
}

const MeetingNotesSettings: FC<MeetingNotesSettingsProps> = ({
  downloadedModels,
  compatibleModelIds,
  supportsRealtimeAsr,
  profile
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

  const detailedAvailable = isDetailedSummaryAvailable(profile)
  const detailedReason = detailedUnavailableReason(profile)

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

  const handleSummaryDepthChange = (value: string): void => {
    setConfig.mutate({
      key: 'meeting',
      value: {
        ...meetingConfig,
        summaryDepth: value as SummaryDepth
      }
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

          {/* Summary depth */}
          <div className="flex items-center justify-between py-4">
            <div className="flex-1 pr-4">
              <p className="text-sm font-medium">Summary length</p>
              <p className="text-xs text-muted-foreground">
                Default length for meeting and media summaries. Longer summaries capture more detail
                but use more memory and take longer. Balanced is recommended for most machines.
                {!detailedAvailable && ` ${detailedReason}`}
              </p>
            </div>
            <Select
              value={resolveSelectableDepth(meetingConfig.summaryDepth, detailedAvailable)}
              onValueChange={handleSummaryDepthChange}
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUMMARY_DEPTH_OPTIONS.map((opt) => (
                  <SelectItem
                    key={opt.value}
                    value={opt.value}
                    disabled={opt.value === 'aggressive' && !detailedAvailable}
                  >
                    {opt.label}
                  </SelectItem>
                ))}
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
