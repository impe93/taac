import { type FC, useEffect, useMemo } from 'react'
import { Sparkles, Loader2, Cpu } from 'lucide-react'
import type { ModelDefinition } from '@main/ai/types'
import { Button } from '@renderer/components/ui/button'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { useDownloadedModels, useModelDownload } from '@renderer/hooks/useModels'
import { useModelProfile } from '@renderer/hooks/useHardware'
import { useConfig, useSetConfig } from '@renderer/hooks/useConfig'
import { ModelFeatureCard } from '@renderer/components/models/ModelFeatureCard'
import { FEATURES, resolveFeatureModels, type CuratedFeature } from '@renderer/lib/modelFeatures'
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

  const handleDownload = (modelId: string): void => {
    if (!isModelComplete(modelId)) download(modelId)
  }

  const handleDownloadAndContinue = (): void => {
    for (const rf of requiredFeatures) {
      for (const m of rf.models) {
        if (!isModelComplete(m.id)) download(m.id)
      }
    }
    dispatch({ type: 'NEXT_STEP' })
  }

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
          <Skeleton className="h-28 w-full rounded-lg" />
          <Skeleton className="h-28 w-full rounded-lg" />
          <Skeleton className="h-28 w-full rounded-lg" />
        </div>
      </div>
    )
  }

  const { hardware } = profile
  const ramLabel = formatRamGb(hardware.memory.totalBytes)
  const cpuLabel = hardware.cpu.brand.trim() || 'Unknown CPU'

  // Once all required downloads are on their way (or done), the primary action is
  // simply to move on — downloads finish in the background and are tracked by the
  // indicator in the top bar.
  const canContinue = allRequiredDownloaded || isAnyDownloading

  return (
    <div className="flex flex-col items-center space-y-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-ai-soft">
        <Sparkles className="size-8 text-ai" />
      </div>

      <div className="space-y-2">
        <h1 className="font-serif text-4xl font-normal tracking-tight">Make it yours</h1>
        <p className="text-lg text-muted-foreground">
          TaacNotes keeps its AI private by running it right on your Mac. Pick what you’d like —
          everything downloads in the background while you explore.
        </p>
      </div>

      {/* Compact hardware summary */}
      <div className="flex w-full items-center gap-2.5 rounded-lg border bg-muted/30 px-3 py-2 text-left">
        <Cpu className="size-4 shrink-0 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          Tuned for your{' '}
          <span className="font-medium text-foreground">{formatTierLabel(hardware.tier)}</span> Mac
          {' · '}
          {ramLabel} RAM · {cpuLabel}
        </p>
      </div>

      <div className="grid w-full gap-4">
        {resolvedFeatures.map((rf) => (
          <ModelFeatureCard
            key={rf.feature.key}
            feature={rf.feature}
            recommended={rf.models}
            downloadedModelIds={downloadedIds}
            progress={progress}
            onDownload={handleDownload}
            onPause={pause}
            onResume={resume}
          />
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        You can keep using the app while models download, and manage them anytime in Settings.
      </p>

      <div className="flex items-center gap-3">
        <Button variant="ghost" onClick={handleSkip}>
          Skip for now
        </Button>
        {canContinue ? (
          <Button size="lg" onClick={handleContinue}>
            {isAnyDownloading && <Loader2 className="size-4 animate-spin" />}
            Continue
          </Button>
        ) : (
          <Button size="lg" onClick={handleDownloadAndContinue}>
            Download &amp; Continue
          </Button>
        )}
      </div>
    </div>
  )
}
