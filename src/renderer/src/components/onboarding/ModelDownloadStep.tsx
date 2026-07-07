import { type FC, useEffect, useMemo } from 'react'
import { Download, Pause, Play, CheckCircle2, AlertCircle, Loader2, Info, Cpu } from 'lucide-react'
import type { DownloadProgress, ModelDefinition } from '@main/ai/types'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent } from '@renderer/components/ui/card'
import { Progress } from '@renderer/components/ui/progress'
import { Badge } from '@renderer/components/ui/badge'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { useDownloadedModels, useModelDownload } from '@renderer/hooks/useModels'
import { useModelProfile } from '@renderer/hooks/useHardware'
import { useConfig, useSetConfig } from '@renderer/hooks/useConfig'
import { formatSize, formatSpeed, formatETA } from '@renderer/lib/format'
import {
  FEATURES,
  resolveFeatureModels,
  computeFeatureProgress,
  type CuratedFeature
} from '@renderer/lib/modelFeatures'
import type { OnboardingAction, OnboardingState } from './OnboardingWizard'

const formatRamGb = (bytes: number): string => {
  const gb = bytes / (1024 * 1024 * 1024)
  return `${Math.round(gb)} GB`
}

const formatTierLabel = (tier: string): string => tier.charAt(0).toUpperCase() + tier.slice(1)

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
  const { data: profile, isLoading: isLoadingProfile } = useModelProfile()
  const { progress, download, pause, resume } = useModelDownload()
  const setConfig = useSetConfig<'meeting'>()
  const { data: meetingConfig } = useConfig('meeting')

  const downloadedIds = useMemo(
    () => new Set(downloadedModels?.map((m) => m.id) ?? []),
    [downloadedModels]
  )

  const resolvedFeatures = useMemo<ResolvedFeature[]>(() => {
    if (!profile) return []
    return FEATURES.map((feature) => ({
      feature,
      models: resolveFeatureModels(profile, feature.key)
    }))
  }, [profile])

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

  // Set tier-optimal meeting config as soon as the profile is available
  useEffect(() => {
    if (!profile || !meetingConfig) return

    const { whisper, asr } = profile.features.meeting
    const nextWhisperId = whisper.id
    const nextAsrId = asr?.id ?? meetingConfig.asrModelId

    if (meetingConfig.whisperModelId === nextWhisperId && meetingConfig.asrModelId === nextAsrId) {
      return
    }

    setConfig.mutate({
      key: 'meeting',
      value: { ...meetingConfig, whisperModelId: nextWhisperId, asrModelId: nextAsrId }
    })
  }, [profile, meetingConfig, setConfig])

  // Sync completion state to wizard
  useEffect(() => {
    if (allRequiredDownloaded && !state.models.chatModelDownloaded) {
      dispatch({ type: 'SET_MODEL_STATUS', chat: true, embedding: true })
    }
  }, [allRequiredDownloaded, state.models.chatModelDownloaded, dispatch])

  // Persist transcription model choices as downloads complete
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

  if (isLoadingModels || isLoadingProfile || resolvedFeatures.length === 0 || !profile) {
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

  const { hardware } = profile
  const ramLabel = formatRamGb(hardware.memory.totalBytes)
  const cpuLabel = hardware.cpu.brand.trim() || 'Unknown CPU'

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

      <Card className="w-full text-left">
        <CardContent className="flex items-start gap-3 py-4">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Cpu className="size-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {formatTierLabel(hardware.tier)} tier · {ramLabel} RAM · {cpuLabel}
            </p>
            <p className="text-xs text-muted-foreground">
              Each bundle below includes the optimal model variant for your machine. Only compatible
              models are offered.
            </p>
          </div>
        </CardContent>
      </Card>

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

      {isAnyDownloading && (
        <Alert className="text-left">
          <Info className="size-4" />
          <AlertDescription>
            Don’t close the application during download. Models are saved locally and used offline.
          </AlertDescription>
        </Alert>
      )}

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

  const activeProgress = useMemo(
    () => computeFeatureProgress(models, progressMap, isModelComplete),
    [models, progressMap, isModelComplete]
  )

  const isDownloading = activeProgress.activeStatus !== null
  const showError = !!activeProgress.lastError && !isDownloading && !isComplete

  const missingIds = models.filter((m) => !isModelComplete(m.id)).map((m) => m.id)

  return (
    <Card className="text-left">
      <CardContent className="space-y-3 pt-6">
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

        {!isComplete && !isDownloading && (
          <div className="flex items-start gap-2 rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>{feature.losesIfSkipped}</span>
          </div>
        )}

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
