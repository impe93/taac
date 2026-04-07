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
import { useSetConfig } from '@renderer/hooks/useConfig'
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
  resolveModelIds: (tier: HardwareTier, hasGpu: boolean) => string[]
}

const TIER_RANK: Record<HardwareTier, number> = { low: 0, medium: 1, high: 2, ultra: 3 }

const pickWhisperId = (tier: HardwareTier, hasGpu: boolean): string => {
  const variant = hasGpu ? 'ggml' : 'onnx'
  if (TIER_RANK[tier] >= TIER_RANK['high']) return `whisper-large-v3-turbo-${variant}`
  if (TIER_RANK[tier] >= TIER_RANK['medium']) return `whisper-small-${variant}`
  return `whisper-base-${variant}`
}

const FEATURES: CuratedFeature[] = [
  {
    key: 'chat',
    icon: Bot,
    label: 'AI Chat',
    description:
      'Conversa in linguaggio naturale con un assistente AI che gira interamente sul tuo dispositivo.',
    losesIfSkipped:
      'Senza questo modello non potrai chattare con le tue note né generare contenuti con l’AI.',
    optional: false,
    resolveModelIds: () => ['qwen3-5-2b-q8']
  },
  {
    key: 'search',
    icon: Search,
    label: 'Ricerca semantica',
    description:
      'Trova le tue note per significato, non solo per parole chiave. Powered by RAG locale.',
    losesIfSkipped:
      'Senza questi modelli la ricerca avanzata e il recupero contestuale delle note saranno disabilitati.',
    optional: false,
    resolveModelIds: () => ['nomic-embed-text-v2-moe', 'qwen3-reranker-0.6b-q8']
  },
  {
    key: 'meeting',
    icon: Mic,
    label: 'Meeting Notes',
    description:
      'Registra riunioni, trascrivi automaticamente l’audio e identifica i diversi speaker — tutto offline.',
    losesIfSkipped:
      'Senza questi modelli non potrai registrare meeting né generare trascrizioni e riassunti automatici.',
    optional: true,
    resolveModelIds: (tier, hasGpu) => [
      pickWhisperId(tier, hasGpu),
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

  const downloadedIds = useMemo(
    () => new Set(downloadedModels?.map((m) => m.id) ?? []),
    [downloadedModels]
  )

  const hasGpu = !!(hardwareInfo?.gpu.hasMetal || hardwareInfo?.gpu.hasCuda)
  const tier: HardwareTier = hardwareInfo?.tier ?? 'low'

  // Resolve curated bundles into actual ModelDefinition lists
  const resolvedFeatures = useMemo<ResolvedFeature[]>(() => {
    if (!availableModels) return []
    const byId = new Map(availableModels.map((m) => [m.id, m]))
    return FEATURES.map((feature) => ({
      feature,
      models: feature
        .resolveModelIds(tier, hasGpu)
        .map((id) => byId.get(id))
        .filter((m): m is ModelDefinition => !!m)
    }))
  }, [availableModels, tier, hasGpu])

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

  // Persist whisperModelId when transcription model completes
  useEffect(() => {
    const meeting = resolvedFeatures.find((rf) => rf.feature.key === 'meeting')
    if (!meeting) return
    const transcriptionModel = meeting.models.find((m) => m.capabilities.includes('transcription'))
    if (!transcriptionModel) return
    const p = progress.get(transcriptionModel.id)
    if (p?.status === 'completed') {
      setConfig.mutate({
        key: 'meeting',
        value: { whisperModelId: transcriptionModel.id } as Parameters<
          typeof setConfig.mutate
        >[0]['value']
      })
    }
  }, [progress, resolvedFeatures, setConfig])

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
        <h1 className="text-3xl font-bold tracking-tight">Configura i modelli AI</h1>
        <p className="text-lg text-muted-foreground">
          TaacNotes funziona con modelli AI eseguiti localmente sul tuo dispositivo. Abbiamo
          selezionato i migliori per il tuo hardware.
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

      {/* Warning durante download */}
      {isAnyDownloading && (
        <Alert className="text-left">
          <Info className="size-4" />
          <AlertDescription>
            Non chiudere l’applicazione durante il download. I modelli verranno salvati localmente e
            usati offline.
          </AlertDescription>
        </Alert>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" onClick={handleSkip}>
          Salta per ora
        </Button>
        {allRequiredDownloaded ? (
          <Button size="lg" onClick={handleContinue}>
            Continua
          </Button>
        ) : (
          <Button size="lg" onClick={handleDownloadAllRequired} disabled={isAnyDownloading}>
            {isAnyDownloading && <Loader2 className="size-4 animate-spin" />}
            Scarica i modelli richiesti
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
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Icon className="size-5 text-primary" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{feature.label}</p>
                {feature.optional && (
                  <Badge variant="outline" className="text-xs">
                    Opzionale
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
                Pronto
              </Badge>
            ) : !isDownloading ? (
              <Button
                size="sm"
                variant={feature.optional ? 'outline' : 'default'}
                onClick={() => onDownload(missingIds)}
              >
                <Download className="size-3.5" />
                Scarica
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
            <span className="text-muted-foreground">Totale</span>
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
                {activeProgress.activeStatus === 'downloading' && activeProgress.activeSpeed > 0 && (
                  <>
                    {' '}
                    &middot; {formatSpeed(activeProgress.activeSpeed)} &middot; ~
                    {formatETA(activeProgress.activeEta)}
                  </>
                )}
                {activeProgress.activeStatus === 'paused' && ' · In pausa'}
                {activeProgress.activeStatus === 'pending' && ' · Preparazione...'}
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
                      Pausa
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onResume(activeProgress.activeModelId!)}
                    >
                      <Play className="size-3.5" />
                      Riprendi
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
                Riprova
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
