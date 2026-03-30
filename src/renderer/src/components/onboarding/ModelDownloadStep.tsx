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
  Zap
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { DownloadProgress, ModelDefinition } from '@main/ai/types'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent } from '@renderer/components/ui/card'
import { Progress } from '@renderer/components/ui/progress'
import { Badge } from '@renderer/components/ui/badge'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { Separator } from '@renderer/components/ui/separator'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { useDownloadedModels, useModelDownload } from '@renderer/hooks/useModels'
import { useHardwareInfo, useAvailableModels } from '@renderer/hooks/useHardware'
import { useSetConfig } from '@renderer/hooks/useConfig'
import { formatSize, formatSpeed, formatETA } from '@renderer/lib/format'
import type { OnboardingAction, OnboardingState } from './OnboardingWizard'

// =============================================================================
// Constants
// =============================================================================

interface ModelConfig {
  id: string
  name: string
  size: string
  purpose: string
  icon: LucideIcon
  label: string
}

const MODELS: ModelConfig[] = [
  {
    id: 'qwen3-4b-instruct-2507-q8',
    name: 'Qwen3 4B Instruct',
    size: '~4.3 GB',
    purpose: 'Powers the AI assistant',
    icon: Bot,
    label: 'AI Chat Model'
  },
  {
    id: 'nomic-embed-text-v2-moe',
    name: 'Nomic Embed v2',
    size: '~512 MB',
    purpose: 'Powers semantic note search',
    icon: Search,
    label: 'Search Model'
  }
]

const TIER_ORDER = ['low', 'medium', 'high', 'ultra'] as const

// =============================================================================
// Component
// =============================================================================

interface ModelDownloadStepProps {
  state: OnboardingState
  dispatch: React.Dispatch<OnboardingAction>
}

export const ModelDownloadStep: FC<ModelDownloadStepProps> = ({ state, dispatch }) => {
  const { data: downloadedModels, isLoading: isLoadingModels } = useDownloadedModels()
  const { data: hardwareInfo, isLoading: isLoadingHardware } = useHardwareInfo()
  const { data: availableModels } = useAvailableModels()
  const { progress, download, pause, resume } = useModelDownload()
  const setConfig = useSetConfig<'meeting'>()

  const downloadedModelIds = useMemo(
    () => new Set(downloadedModels?.map((m) => m.id) ?? []),
    [downloadedModels]
  )

  const isModelComplete = (modelId: string): boolean => {
    return downloadedModelIds.has(modelId) || progress.get(modelId)?.status === 'completed'
  }

  const allDownloaded = MODELS.every((m) => isModelComplete(m.id))

  // GPU available when Metal (macOS Apple Silicon) or CUDA (Windows/Linux) is detected
  const hasGpu = !!(hardwareInfo?.gpu.hasMetal || hardwareInfo?.gpu.hasCuda)

  // Transcription models from registry — GGML (GPU) when GPU is detected, ONNX (CPU) otherwise
  const transcriptionModels = useMemo(
    () =>
      (availableModels ?? [])
        .filter((m) => m.capabilities.includes('transcription'))
        .filter((m) => (hasGpu ? m.format === 'ggml' : m.format !== 'ggml'))
        .sort((a, b) => TIER_ORDER.indexOf(a.hardwareTier) - TIER_ORDER.indexOf(b.hardwareTier)),
    [availableModels, hasGpu]
  )

  // The best transcription model compatible with the user's hardware tier
  const recommendedTranscriptionId = useMemo(() => {
    if (!hardwareInfo || transcriptionModels.length === 0) return null
    const userTierIndex = TIER_ORDER.indexOf(hardwareInfo.tier)
    const compatible = transcriptionModels.filter(
      (m) => TIER_ORDER.indexOf(m.hardwareTier) <= userTierIndex
    )
    if (compatible.length === 0) return transcriptionModels[0].id
    return compatible[compatible.length - 1].id // highest compatible tier
  }, [hardwareInfo, transcriptionModels])

  // Sync completion state to wizard
  useEffect(() => {
    if (allDownloaded && !state.models.chatModelDownloaded) {
      dispatch({ type: 'SET_MODEL_STATUS', chat: true, embedding: true })
    }
  }, [allDownloaded, state.models.chatModelDownloaded, dispatch])

  // Update whisperModelId config when a transcription model download completes
  useEffect(() => {
    const transcriptionIds = new Set(transcriptionModels.map((m) => m.id))
    for (const [modelId, p] of progress) {
      if (p.status === 'completed' && transcriptionIds.has(modelId)) {
        setConfig.mutate({
          key: 'meeting',
          value: { whisperModelId: modelId } as Parameters<typeof setConfig.mutate>[0]['value']
        })
        break
      }
    }
  }, [progress, transcriptionModels, setConfig])

  // Handlers
  const handleDownloadAll = (): void => {
    for (const model of MODELS) {
      if (!isModelComplete(model.id)) {
        download(model.id)
      }
    }
  }

  const handlePause = (modelId: string): void => {
    pause(modelId)
  }

  const handleResume = (modelId: string): void => {
    resume(modelId)
  }

  const handleRetry = (modelId: string): void => {
    download(modelId)
  }

  const handleContinue = (): void => {
    dispatch({ type: 'NEXT_STEP' })
  }

  const handleSkip = (): void => {
    dispatch({ type: 'SKIP_MODELS' })
  }

  // Loading state
  if (isLoadingModels || isLoadingHardware) {
    return (
      <div className="flex flex-col items-center space-y-6 text-center">
        <Skeleton className="h-16 w-16 rounded-2xl" />
        <div className="w-full space-y-3">
          <Skeleton className="mx-auto h-8 w-64" />
          <Skeleton className="mx-auto h-5 w-96" />
        </div>
        <Skeleton className="h-8 w-48" />
        <div className="grid w-full gap-4">
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-32 w-full rounded-lg" />
        </div>
      </div>
    )
  }

  const isAnyDownloading = MODELS.some((m) => {
    const status = progress.get(m.id)?.status
    return status === 'downloading' || status === 'pending'
  })

  return (
    <div className="flex flex-col items-center space-y-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10">
        <Download className="size-8 text-primary" />
      </div>

      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Set Up AI Models</h1>
        <p className="text-lg text-muted-foreground">
          TaacNotes uses local AI models for chat and semantic search. Download them now to unlock
          the full experience.
        </p>
      </div>

      {/* Hardware info */}
      {hardwareInfo && (
        <Badge variant="secondary">
          {hardwareInfo.tier.charAt(0).toUpperCase() + hardwareInfo.tier.slice(1)} tier
          <Separator orientation="vertical" className="mx-2 h-3" />
          {formatSize(hardwareInfo.memory.totalBytes)} RAM
        </Badge>
      )}

      {/* Required model cards */}
      <div className="grid w-full gap-4">
        {MODELS.map((model) => (
          <ModelCard
            key={model.id}
            model={model}
            isDownloaded={isModelComplete(model.id)}
            progress={progress.get(model.id)}
            onPause={handlePause}
            onResume={handleResume}
            onRetry={handleRetry}
          />
        ))}
      </div>

      {/* Total size note */}
      <p className="text-sm text-muted-foreground">
        Required download: ~4.8 GB (chat &amp; search models)
      </p>

      {/* Transcription models section */}
      {transcriptionModels.length > 0 && (
        <div className="w-full space-y-4">
          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {hasGpu ? <Zap className="size-4 text-yellow-500" /> : <Mic className="size-4" />}
              <span>Transcription Model</span>
              {hasGpu && (
                <Badge variant="outline" className="gap-1 text-xs text-yellow-600 border-yellow-400/60">
                  <Zap className="size-2.5" />
                  GPU
                </Badge>
              )}
              <Badge variant="outline" className="text-xs">
                Optional
              </Badge>
            </div>
            <Separator className="flex-1" />
          </div>

          <p className="text-sm text-muted-foreground">
            Required for Meeting Notes — transcribes speech to text locally.{' '}
            {hasGpu
              ? 'GPU-accelerated models are shown for your hardware. You can download this later from Settings.'
              : 'You can download this later from Settings.'}
          </p>

          <div className="grid w-full gap-3">
            {transcriptionModels.map((model) => (
              <TranscriptionModelCard
                key={model.id}
                model={model}
                isDownloaded={isModelComplete(model.id)}
                isRecommended={model.id === recommendedTranscriptionId}
                progress={progress.get(model.id)}
                onDownload={download}
                onPause={handlePause}
                onResume={handleResume}
                onRetry={handleRetry}
              />
            ))}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" onClick={handleSkip}>
          Skip for now
        </Button>
        {allDownloaded ? (
          <Button size="lg" onClick={handleContinue}>
            Continue
          </Button>
        ) : (
          <Button size="lg" onClick={handleDownloadAll} disabled={isAnyDownloading}>
            {isAnyDownloading && <Loader2 className="size-4 animate-spin" />}
            Download All
          </Button>
        )}
      </div>
    </div>
  )
}

// =============================================================================
// Model Card (internal)
// =============================================================================

interface ModelCardProps {
  model: ModelConfig
  isDownloaded: boolean
  progress: DownloadProgress | undefined
  onPause: (modelId: string) => void
  onResume: (modelId: string) => void
  onRetry: (modelId: string) => void
}

const ModelCard: FC<ModelCardProps> = ({
  model,
  isDownloaded,
  progress,
  onPause,
  onResume,
  onRetry
}) => {
  const Icon = model.icon
  const status = progress?.status

  return (
    <Card className="text-left">
      <CardContent className="space-y-3 pt-6">
        {/* Header row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
              <Icon className="size-5 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="font-semibold">{model.name}</p>
                <Badge variant="outline" className="text-xs">
                  {model.label}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {model.size} &middot; {model.purpose}
              </p>
            </div>
          </div>

          {/* Status indicator */}
          {isDownloaded && (
            <Badge variant="secondary" className="gap-1">
              <CheckCircle2 className="size-3" />
              Downloaded
            </Badge>
          )}
        </div>

        {/* Download progress */}
        {!isDownloaded && (status === 'downloading' || status === 'paused') && progress && (
          <div className="space-y-2">
            <Progress value={progress.percentage} />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {formatSize(progress.bytesDownloaded)} / {formatSize(progress.totalBytes)}
                {status === 'downloading' && (
                  <>
                    {' '}
                    &middot; {formatSpeed(progress.speed)} &middot; ~{formatETA(progress.eta)} left
                  </>
                )}
                {status === 'paused' && ' · Paused'}
              </span>
              <span>{Math.round(progress.percentage)}%</span>
            </div>
            <div className="flex justify-end">
              {status === 'downloading' ? (
                <Button variant="ghost" size="sm" onClick={() => onPause(model.id)}>
                  <Pause className="size-3.5" />
                  Pause
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => onResume(model.id)}>
                  <Play className="size-3.5" />
                  Resume
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Pending state (download triggered but not started) */}
        {!isDownloaded && status === 'pending' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Preparing download...
          </div>
        )}

        {/* Error state */}
        {!isDownloaded && status === 'error' && progress && (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertDescription className="flex items-center justify-between">
              <span>{progress.error ?? 'Download failed'}</span>
              <Button variant="ghost" size="sm" onClick={() => onRetry(model.id)}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}

// =============================================================================
// Transcription Model Card (internal)
// =============================================================================

interface TranscriptionModelCardProps {
  model: ModelDefinition
  isDownloaded: boolean
  isRecommended: boolean
  progress: DownloadProgress | undefined
  onDownload: (modelId: string) => void
  onPause: (modelId: string) => void
  onResume: (modelId: string) => void
  onRetry: (modelId: string) => void
}

const TranscriptionModelCard: FC<TranscriptionModelCardProps> = ({
  model,
  isDownloaded,
  isRecommended,
  progress,
  onDownload,
  onPause,
  onResume,
  onRetry
}) => {
  const status = progress?.status

  return (
    <Card className={isRecommended ? 'border-primary/40 text-left' : 'text-left'}>
      <CardContent className="space-y-3 pt-4 pb-4">
        {/* Header row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10">
              <Mic className="size-4 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold">{model.name}</p>
                {isRecommended && (
                  <Badge variant="default" className="text-xs">
                    Recommended
                  </Badge>
                )}
                {model.format === 'ggml' && (
                  <Badge variant="outline" className="gap-1 text-xs text-yellow-600 border-yellow-400/60">
                    <Zap className="size-2.5" />
                    GPU
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                ~{formatSize(model.sizeBytes)} &middot;{' '}
                {model.hardwareTier.charAt(0).toUpperCase() + model.hardwareTier.slice(1)} tier
              </p>
            </div>
          </div>

          {/* Status / download button */}
          <div className="shrink-0">
            {isDownloaded ? (
              <Badge variant="secondary" className="gap-1">
                <CheckCircle2 className="size-3" />
                Downloaded
              </Badge>
            ) : !status || status === 'error' ? (
              <Button
                variant={isRecommended ? 'default' : 'outline'}
                size="sm"
                onClick={() => onDownload(model.id)}
              >
                <Download className="size-3.5" />
                Download
              </Button>
            ) : null}
          </div>
        </div>

        {/* Download progress */}
        {!isDownloaded && (status === 'downloading' || status === 'paused') && progress && (
          <div className="space-y-2">
            <Progress value={progress.percentage} />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {formatSize(progress.bytesDownloaded)} / {formatSize(progress.totalBytes)}
                {status === 'downloading' && (
                  <>
                    {' '}
                    &middot; {formatSpeed(progress.speed)} &middot; ~{formatETA(progress.eta)} left
                  </>
                )}
                {status === 'paused' && ' · Paused'}
              </span>
              <span>{Math.round(progress.percentage)}%</span>
            </div>
            <div className="flex justify-end">
              {status === 'downloading' ? (
                <Button variant="ghost" size="sm" onClick={() => onPause(model.id)}>
                  <Pause className="size-3.5" />
                  Pause
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => onResume(model.id)}>
                  <Play className="size-3.5" />
                  Resume
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Pending state */}
        {!isDownloaded && status === 'pending' && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Preparing download...
          </div>
        )}

        {/* Error state */}
        {!isDownloaded && status === 'error' && progress && (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertDescription className="flex items-center justify-between">
              <span>{progress.error ?? 'Download failed'}</span>
              <Button variant="ghost" size="sm" onClick={() => onRetry(model.id)}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
