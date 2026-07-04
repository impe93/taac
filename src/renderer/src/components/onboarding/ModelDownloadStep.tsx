import { type FC, useEffect, useMemo } from 'react'
import {
  Bot,
  Search,
  Download,
  Pause,
  Play,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Mic,
  Info
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { DownloadProgress, ModelDefinition, HardwareTier } from '@main/ai/types'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent } from '@renderer/components/ui/card'
import { Progress } from '@renderer/components/ui/progress'
import { Badge } from '@renderer/components/ui/badge'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { useDownloadedModels, useModelDownload } from '@renderer/hooks/useModels'
import { useHardwareInfo, useAvailableModels } from '@renderer/hooks/useHardware'
import { useConfig, useSetConfig } from '@renderer/hooks/useConfig'
import { formatSize, formatSpeed, formatETA } from '@renderer/lib/format'
import type { OnboardingAction, OnboardingState } from './OnboardingWizard'

// =============================================================================
// Curated bundles per feature
// =============================================================================

type FeatureKey = 'chat' | 'search' | 'meeting'

interface CuratedFeature {
  key: FeatureKey
  icon: LucideIcon
  label: string
  description: string
  losesIfSkipped: string
  optional: boolean
  resolveModelIds: (tier: HardwareTier, hasGpu: boolean, realtimeAsr: boolean) => string[]
}

const TIER_RANK: Record<HardwareTier, number> = { low: 0, medium: 1, high: 2, ultra: 3 }

// A single whisper.cpp (GGML) engine handles both GPU and CPU, so the variant is
// always GGML — the model size is chosen purely by hardware tier.
const pickWhisperId = (tier: HardwareTier): string => {
  if (TIER_RANK[tier] >= TIER_RANK['high']) return 'whisper-large-v3-turbo-ggml'
  if (TIER_RANK[tier] >= TIER_RANK['medium']) return 'whisper-small-ggml'
  return 'whisper-base-ggml'
}

// Realtime transcription model (Qwen3-ASR via MLX, Apple Silicon only) —
// 1.7B for medium+ machines, 0.6B keeps low-tier machines responsive.
const pickAsrId = (tier: HardwareTier): string =>
  TIER_RANK[tier] >= TIER_RANK['medium'] ? 'qwen3-asr-1.7b-mlx-8bit' : 'qwen3-asr-0.6b-mlx-8bit'

const FEATURES: CuratedFeature[] = [
  {
    key: 'chat',
    icon: Bot,
    label: 'AI Chat',
    description: 'Converse naturally with an AI assistant that runs entirely on your device.',
    losesIfSkipped:
      'Without this model you won’t be able to chat with your notes or generate AI content.',
    optional: false,
    resolveModelIds: () => ['qwen3-5-2b-q8']
  },
  {
    key: 'search',
    icon: Search,
    label: 'Semantic Search',
    description: 'Find your notes by meaning, not just keywords. Powered by local RAG.',
    losesIfSkipped:
      'Without these models, advanced search and contextual note retrieval will be disabled.',
    optional: false,
    resolveModelIds: () => ['embeddinggemma-300m-q8', 'qwen3-reranker-0.6b-q8']
  },
  {
    key: 'meeting',
    icon: Mic,
    label: 'Meeting Notes',
    description:
      'Record meetings, automatically transcribe audio, and identify different speakers — all offline.',
    losesIfSkipped:
      'Without these models you won’t be able to record meetings or generate automatic transcriptions and summaries.',
    optional: true,
    resolveModelIds: (tier, _hasGpu, realtimeAsr) => [
      // Whisper stays as the post-processing fallback on every platform
      pickWhisperId(tier),
      ...(realtimeAsr ? [pickAsrId(tier), 'silero-vad-onnx'] : []),
      'sherpa-onnx-pyannote-segmentation',
      'sherpa-onnx-nemo-titanet-small'
    ]
  }
]

// =============================================================================
// Component
// =============================================================================

interface ModelDownloadStepProps {
  state: OnboardingState
  dispatch: React.Dispatch<OnboardingAction>
}

interface ResolvedFeature {
  feature: CuratedFeature
  models: ModelDefinition[]
}

export const ModelDownloadStep: FC<ModelDownloadStepProps> = ({ state, dispatch }) => {
  const { data: downloadedModels, isLoading: isLoadingModels } = useDownloadedModels()
  const { data: hardwareInfo, isLoading: isLoadingHardware } = useHardwareInfo()
  const { data: availableModels } = useAvailableModels()
  const { progress, download, pause, resume } = useModelDownload()
  const setConfig = useSetConfig<'meeting'>()
  const { data: meetingConfig } = useConfig('meeting')

  const downloadedIds = useMemo(
    () => new Set(downloadedModels?.map((m) => m.id) ?? []),
    [downloadedModels]
  )

  const hasGpu = !!(hardwareInfo?.gpu.hasMetal || hardwareInfo?.gpu.hasCuda)
  const tier: HardwareTier = hardwareInfo?.tier ?? 'low'
  // Realtime ASR (Qwen3-ASR via MLX) runs on macOS Apple Silicon only
  const supportsRealtimeAsr =
    window.platform === 'darwin' && !!hardwareInfo?.cpu.brand.includes('Apple')

  // Resolve curated bundles into actual ModelDefinition lists
  const resolvedFeatures = useMemo<ResolvedFeature[]>(() => {
    if (!availableModels) return []
    const byId = new Map(availableModels.map((m) => [m.id, m]))
    return FEATURES.map((feature) => ({
      feature,
      models: feature
        .resolveModelIds(tier, hasGpu, supportsRealtimeAsr)
        .map((id) => byId.get(id))
        .filter((m): m is ModelDefinition => !!m)
    }))
  }, [availableModels, tier, hasGpu, supportsRealtimeAsr])

  const isModelComplete = (modelId: string): boolean =>
    downloadedIds.has(modelId) || progress.get(modelId)?.status === 'completed'

  const isFeatureComplete = (rf: ResolvedFeature): boolean =>
    rf.models.length > 0 && rf.models.every((m) => isModelComplete(m.id))

  const requiredFeatures = resolvedFeatures.filter((rf) => !rf.feature.optional)
  const allRequiredDownloaded =
    requiredFeatures.length > 0 && requiredFeatures.every(isFeatureComplete)

  const isAnyDownloading = useMemo(() => {
    for (const [, p] of progress) {
      if (p.status === 'downloading' || p.status === 'pending') return true
    }
    return false
  }, [progress])

  // Sync completion state to wizard
  useEffect(() => {
    if (allRequiredDownloaded && !state.models.chatModelDownloaded) {
      dispatch({ type: 'SET_MODEL_STATUS', chat: true, embedding: true })
    }
  }, [allRequiredDownloaded, state.models.chatModelDownloaded, dispatch])

  // Persist the transcription model choices as their downloads complete.
  // config:set replaces the whole `meeting` object, so updates are merged
  // over the current config to avoid clobbering other fields.
  useEffect(() => {
    const meeting = resolvedFeatures.find((rf) => rf.feature.key === 'meeting')
    if (!meeting || !meetingConfig) return

    const whisperModel = meeting.models.find(
      (m) => m.capabilities.includes('transcription') && m.format === 'ggml'
    )
    const asrModel = meeting.models.find(
      (m) => m.capabilities.includes('transcription') && m.format === 'mlx'
    )

    const updates: { whisperModelId?: string; asrModelId?: string } = {}
    if (whisperModel && progress.get(whisperModel.id)?.status === 'completed') {
      updates.whisperModelId = whisperModel.id
    }
    if (asrModel && progress.get(asrModel.id)?.status === 'completed') {
      updates.asrModelId = asrModel.id
    }

    const isNoop =
      (updates.whisperModelId ?? meetingConfig.whisperModelId) === meetingConfig.whisperModelId &&
      (updates.asrModelId ?? meetingConfig.asrModelId) === meetingConfig.asrModelId
    if (Object.keys(updates).length === 0 || isNoop) return

    setConfig.mutate({ key: 'meeting', value: { ...meetingConfig, ...updates } })
  }, [progress, resolvedFeatures, meetingConfig, setConfig])

  // Handlers
  const handleDownloadMissing = (ids: string[]): void => {
    for (const id of ids) {
      if (!isModelComplete(id)) download(id)
    }
  }

  const handleDownloadAllRequired = (): void => {
    const missing: string[] = []
    for (const rf of requiredFeatures) {
      for (const m of rf.models) {
        if (!isModelComplete(m.id)) missing.push(m.id)
      }
    }
    handleDownloadMissing(missing)
  }

  const handlePause = (modelId: string): void => pause(modelId)
  const handleResume = (modelId: string): void => resume(modelId)
  const handleRetry = (modelId: string): void => download(modelId)
  const handleContinue = (): void => dispatch({ type: 'NEXT_STEP' })
  const handleSkip = (): void => dispatch({ type: 'SKIP_MODELS' })

  // Loading state
  if (isLoadingModels || isLoadingHardware || resolvedFeatures.length === 0) {
    return (
      <div className="flex flex-col items-center space-y-6 text-center">
        <Skeleton className="h-16 w-16 rounded-2xl" />
        <div className="w-full space-y-3">
          <Skeleton className="mx-auto h-8 w-64" />
          <Skeleton className="mx-auto h-5 w-96" />
        </div>
        <div className="grid w-full gap-4">
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-32 w-full rounded-lg" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center space-y-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10">
        <Download className="size-8 text-primary" />
      </div>

      <div className="space-y-2">
        <h1 className="font-serif text-4xl font-normal tracking-tight">Configure AI Models</h1>
        <p className="text-lg text-muted-foreground">
          TaacNotes runs AI models locally on your device. We’ve selected the best ones for your
          hardware.
        </p>
      </div>

      {/* Feature cards */}
      <div className="grid w-full gap-4">
        {resolvedFeatures.map((rf) => (
          <FeatureCard
            key={rf.feature.key}
            resolved={rf}
            isComplete={isFeatureComplete(rf)}
            isModelComplete={isModelComplete}
            progressMap={progress}
            onDownload={handleDownloadMissing}
            onPause={handlePause}
            onResume={handleResume}
            onRetry={handleRetry}
          />
        ))}
      </div>

      {/* Warning during download */}
      {isAnyDownloading && (
        <Alert className="text-left">
          <Info className="size-4" />
          <AlertDescription>
            Don’t close the application during download. Models are saved locally and used offline.
          </AlertDescription>
        </Alert>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" onClick={handleSkip}>
          Skip for now
        </Button>
        {allRequiredDownloaded ? (
          <Button size="lg" onClick={handleContinue}>
            Continue
          </Button>
        ) : (
          <Button size="lg" onClick={handleDownloadAllRequired} disabled={isAnyDownloading}>
            {isAnyDownloading && <Loader2 className="size-4 animate-spin" />}
            Download Required Models
          </Button>
        )}
      </div>
    </div>
  )
}

// =============================================================================
// Feature Card (internal)
// =============================================================================

interface FeatureCardProps {
  resolved: ResolvedFeature
  isComplete: boolean
  isModelComplete: (id: string) => boolean
  progressMap: Map<string, DownloadProgress>
  onDownload: (ids: string[]) => void
  onPause: (id: string) => void
  onResume: (id: string) => void
  onRetry: (id: string) => void
}

const FeatureCard: FC<FeatureCardProps> = ({
  resolved,
  isComplete,
  isModelComplete,
  progressMap,
  onDownload,
  onPause,
  onResume,
  onRetry
}) => {
  const { feature, models } = resolved
  const Icon = feature.icon

  const totalSize = models.reduce((acc, m) => acc + m.sizeBytes, 0)

  // Aggregated progress for any model in this bundle currently downloading/paused
  const activeProgress = useMemo(() => {
    let bytesDownloaded = 0
    let totalBytes = 0
    let activeModelId: string | null = null
    let activeStatus: DownloadProgress['status'] | null = null
    let activeSpeed = 0
    let activeEta = 0
    let lastError: string | null = null

    for (const m of models) {
      const p = progressMap.get(m.id)
      if (!p) {
        if (isModelComplete(m.id)) {
          bytesDownloaded += m.sizeBytes
          totalBytes += m.sizeBytes
        } else {
          totalBytes += m.sizeBytes
        }
        continue
      }
      bytesDownloaded += p.bytesDownloaded || (p.status === 'completed' ? m.sizeBytes : 0)
      totalBytes += p.totalBytes || m.sizeBytes
      if (p.status === 'downloading' || p.status === 'pending' || p.status === 'paused') {
        activeModelId = m.id
        activeStatus = p.status
        activeSpeed = p.speed
        activeEta = p.eta
      }
      if (p.status === 'error' && p.error) lastError = p.error
    }

    const percentage = totalBytes > 0 ? (bytesDownloaded / totalBytes) * 100 : 0

    return {
      bytesDownloaded,
      totalBytes,
      percentage,
      activeModelId,
      activeStatus,
      activeSpeed,
      activeEta,
      lastError
    }
  }, [models, progressMap, isModelComplete])

  const isDownloading = activeProgress.activeStatus !== null
  const showError = !!activeProgress.lastError && !isDownloading && !isComplete

  const missingIds = models.filter((m) => !isModelComplete(m.id)).map((m) => m.id)

  return (
    <Card className="text-left">
      <CardContent className="space-y-3 pt-6">
        {/* Header */}
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
              <p className="text-sm text-muted-foreground">{feature.description}</p>
            </div>
          </div>

          <div className="shrink-0">
            {isComplete ? (
              <Badge variant="secondary" className="gap-1">
                <CheckCircle2 className="size-3" />
                Ready
              </Badge>
            ) : !isDownloading ? (
              <Button
                size="sm"
                variant={feature.optional ? 'outline' : 'default'}
                onClick={() => onDownload(missingIds)}
              >
                <Download className="size-3.5" />
                Download
              </Button>
            ) : null}
          </div>
        </div>

        {/* Loses if skipped — only when not complete and not downloading */}
        {!isComplete && !isDownloading && (
          <div className="flex items-start gap-2 rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>{feature.losesIfSkipped}</span>
          </div>
        )}

        {/* Bundle model list */}
        <div className="space-y-1 rounded-md border border-border/50 bg-muted/30 p-2">
          {models.map((m) => {
            const done = isModelComplete(m.id)
            return (
              <div
                key={m.id}
                className="flex items-center justify-between text-xs text-muted-foreground"
              >
                <div className="flex items-center gap-1.5">
                  {done ? (
                    <CheckCircle2 className="size-3 text-green-600" />
                  ) : (
                    <div className="size-3 rounded-full border border-muted-foreground/40" />
                  )}
                  <span>{m.name}</span>
                </div>
                <span>{formatSize(m.sizeBytes)}</span>
              </div>
            )
          })}
          <div className="flex items-center justify-between border-t border-border/50 pt-1 text-xs font-medium">
            <span className="text-muted-foreground">Total</span>
            <span>{formatSize(totalSize)}</span>
          </div>
        </div>

        {/* Aggregated progress */}
        {isDownloading && (
          <div className="space-y-2">
            <Progress value={activeProgress.percentage} />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {formatSize(activeProgress.bytesDownloaded)} /{' '}
                {formatSize(activeProgress.totalBytes)}
                {activeProgress.activeStatus === 'downloading' &&
                  activeProgress.activeSpeed > 0 && (
                    <>
                      {' '}
                      &middot; {formatSpeed(activeProgress.activeSpeed)} &middot; ~
                      {formatETA(activeProgress.activeEta)}
                    </>
                  )}
                {activeProgress.activeStatus === 'paused' && ' · Paused'}
                {activeProgress.activeStatus === 'pending' && ' · Preparing...'}
              </span>
              <span>{Math.round(activeProgress.percentage)}%</span>
            </div>
            {activeProgress.activeModelId &&
              (activeProgress.activeStatus === 'downloading' ||
                activeProgress.activeStatus === 'paused') && (
                <div className="flex justify-end">
                  {activeProgress.activeStatus === 'downloading' ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onPause(activeProgress.activeModelId!)}
                    >
                      <Pause className="size-3.5" />
                      Pause
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onResume(activeProgress.activeModelId!)}
                    >
                      <Play className="size-3.5" />
                      Resume
                    </Button>
                  )}
                </div>
              )}
          </div>
        )}

        {/* Error state */}
        {showError && (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertDescription className="flex items-center justify-between">
              <span>{activeProgress.lastError}</span>
              <Button variant="ghost" size="sm" onClick={() => onRetry(missingIds[0])}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
