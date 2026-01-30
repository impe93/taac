import { type FC, type ReactNode, useState, useMemo } from 'react'
import { Download, Filter, Sparkles, Package, Cpu } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group'
import { Badge } from '@renderer/components/ui/badge'
import { Card, CardContent, CardHeader } from '@renderer/components/ui/card'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { ModelCard } from './ModelCard'
import {
  useAvailableModels,
  useModelRecommendations,
  useHardwareInfo
} from '@renderer/hooks/useHardware'
import { useDownloadedModels, useModelDownload, useDeleteModel } from '@renderer/hooks/useModels'
import { cn } from '@renderer/lib/utils'
import type { HardwareTier, ModelCapability, ModelDefinition } from '@main/ai/types'

interface ModelLibraryProps {
  className?: string
}

type TabValue = 'all' | 'recommended' | 'downloaded'

const TIER_OPTIONS: { value: HardwareTier | 'all'; label: string }[] = [
  { value: 'all', label: 'All Tiers' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'ultra', label: 'Ultra' }
]

const CAPABILITY_OPTIONS: { value: ModelCapability | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'chat', label: 'Chat' },
  { value: 'embedding', label: 'Embedding' },
  { value: 'code', label: 'Code' }
]

const ModelCardSkeleton: FC = () => (
  <Card>
    <CardHeader className="pb-3">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-2 flex-1">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-4 w-full" />
        </div>
        <Skeleton className="h-5 w-16" />
      </div>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-12" />
        <Skeleton className="h-4 w-20" />
      </div>
      <div className="flex gap-1.5">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-20" />
      </div>
      <Skeleton className="h-9 w-full" />
    </CardContent>
  </Card>
)

interface EmptyStateProps {
  icon: FC<{ className?: string }>
  title: string
  description: string
}

const EmptyState: FC<EmptyStateProps> = ({ icon: Icon, title, description }) => (
  <div className="flex flex-col items-center justify-center py-16 text-center">
    <div className="rounded-full bg-muted p-4 mb-4">
      <Icon className="size-8 text-muted-foreground" />
    </div>
    <h3 className="text-lg font-medium mb-2">{title}</h3>
    <p className="text-sm text-muted-foreground max-w-sm">{description}</p>
  </div>
)

export const ModelLibrary: FC<ModelLibraryProps> = ({ className }) => {
  const [activeTab, setActiveTab] = useState<TabValue>('all')
  const [tierFilter, setTierFilter] = useState<HardwareTier | 'all'>('all')
  const [capabilityFilter, setCapabilityFilter] = useState<ModelCapability | 'all'>('all')

  // Queries
  const { data: availableModels, isLoading: isLoadingAvailable } = useAvailableModels()
  const { data: downloadedModels, isLoading: isLoadingDownloaded } = useDownloadedModels()
  const { data: recommendations, isLoading: isLoadingRecommendations } = useModelRecommendations()
  const { data: hardwareInfo } = useHardwareInfo()

  // Mutations
  const { progress, download, pause, resume, cancel } = useModelDownload()
  const deleteModel = useDeleteModel()

  // Create set of downloaded model IDs for quick lookup
  const downloadedModelIds = useMemo(
    () => new Set(downloadedModels?.map((m) => m.id) ?? []),
    [downloadedModels]
  )

  // Create set of recommended model IDs for quick lookup
  const recommendedModelIds = useMemo(
    () => new Set(recommendations?.map((r) => r.modelId) ?? []),
    [recommendations]
  )

  // Get recommended models from available models
  const recommendedModels = useMemo(() => {
    if (!availableModels || !recommendations) return []
    return availableModels.filter((m) => recommendedModelIds.has(m.id))
  }, [availableModels, recommendations, recommendedModelIds])

  // Apply filters to each tab's models
  const filteredAllModels = useMemo(() => {
    const models = availableModels ?? []
    return models.filter((model) => {
      const matchesTier = tierFilter === 'all' || model.hardwareTier === tierFilter
      const matchesCapability =
        capabilityFilter === 'all' || model.capabilities.includes(capabilityFilter)
      return matchesTier && matchesCapability
    })
  }, [availableModels, tierFilter, capabilityFilter])

  const filteredRecommendedModels = useMemo(() => {
    return recommendedModels.filter((model) => {
      const matchesTier = tierFilter === 'all' || model.hardwareTier === tierFilter
      const matchesCapability =
        capabilityFilter === 'all' || model.capabilities.includes(capabilityFilter)
      return matchesTier && matchesCapability
    })
  }, [recommendedModels, tierFilter, capabilityFilter])

  const filteredDownloadedModels = useMemo(() => {
    const models = downloadedModels ?? []
    return models.filter((model) => {
      const matchesTier = tierFilter === 'all' || model.hardwareTier === tierFilter
      const matchesCapability =
        capabilityFilter === 'all' || model.capabilities.includes(capabilityFilter)
      return matchesTier && matchesCapability
    })
  }, [downloadedModels, tierFilter, capabilityFilter])

  // Handlers
  const handleDownload = (modelId: string): void => {
    download(modelId)
  }

  const handleDelete = (modelId: string): void => {
    deleteModel.mutate(modelId)
  }

  const handlePause = (modelId: string): void => {
    pause(modelId)
  }

  const handleResume = (modelId: string): void => {
    resume(modelId)
  }

  const handleCancel = (modelId: string): void => {
    cancel(modelId)
  }

  const handleTierChange = (value: string): void => {
    if (value) setTierFilter(value as HardwareTier | 'all')
  }

  const handleCapabilityChange = (value: string): void => {
    if (value) setCapabilityFilter(value as ModelCapability | 'all')
  }

  const isLoading = isLoadingAvailable || isLoadingDownloaded || isLoadingRecommendations

  const renderModelGrid = (models: ModelDefinition[]): ReactNode => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {models.map((model) => (
        <ModelCard
          key={model.id}
          model={model}
          isDownloaded={downloadedModelIds.has(model.id)}
          downloadProgress={progress.get(model.id)}
          onDownload={handleDownload}
          onDelete={handleDelete}
          onPause={handlePause}
          onResume={handleResume}
          onCancel={handleCancel}
        />
      ))}
    </div>
  )

  const renderLoadingGrid = (): ReactNode => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <ModelCardSkeleton key={i} />
      ))}
    </div>
  )

  return (
    <div className={cn('space-y-6', className)}>
      {/* Header with filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Model Library</h2>
          <p className="text-sm text-muted-foreground">
            Browse and download AI models for local inference
          </p>
        </div>

        {hardwareInfo && (
          <Badge variant="outline" className="gap-1.5 self-start">
            <Cpu className="size-3" />
            {hardwareInfo.tier.charAt(0).toUpperCase() + hardwareInfo.tier.slice(1)} Tier Hardware
          </Badge>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <Filter className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">Filters:</span>
        </div>
        <div className="flex flex-wrap gap-3">
          <ToggleGroup
            type="single"
            value={tierFilter}
            onValueChange={handleTierChange}
            variant="outline"
            size="sm"
          >
            {TIER_OPTIONS.map((option) => (
              <ToggleGroupItem key={option.value} value={option.value} className="text-xs">
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <ToggleGroup
            type="single"
            value={capabilityFilter}
            onValueChange={handleCapabilityChange}
            variant="outline"
            size="sm"
          >
            {CAPABILITY_OPTIONS.map((option) => (
              <ToggleGroupItem key={option.value} value={option.value} className="text-xs">
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)}>
        <TabsList>
          <TabsTrigger value="all" className="gap-1.5">
            <Package className="size-4" />
            All
            {availableModels && (
              <Badge variant="secondary" className="ml-1 text-xs">
                {availableModels.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="recommended" className="gap-1.5">
            <Sparkles className="size-4" />
            Recommended
            {recommendations && (
              <Badge variant="secondary" className="ml-1 text-xs">
                {recommendations.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="downloaded" className="gap-1.5">
            <Download className="size-4" />
            Downloaded
            {downloadedModels && (
              <Badge variant="secondary" className="ml-1 text-xs">
                {downloadedModels.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* All Models Tab */}
        <TabsContent value="all" className="mt-6">
          {isLoading ? (
            renderLoadingGrid()
          ) : filteredAllModels.length > 0 ? (
            <div className="space-y-6">
              {/* Recommended Section (highlighted) */}
              {activeTab === 'all' && filteredRecommendedModels.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Sparkles className="size-5 text-yellow-500" />
                    <h3 className="text-lg font-medium">Recommended for your hardware</h3>
                  </div>
                  <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-4">
                    {renderModelGrid(filteredRecommendedModels)}
                  </div>
                </div>
              )}

              {/* All Models */}
              <div className="space-y-4">
                {activeTab === 'all' && filteredRecommendedModels.length > 0 && (
                  <h3 className="text-lg font-medium">All Models</h3>
                )}
                {renderModelGrid(filteredAllModels)}
              </div>
            </div>
          ) : (
            <EmptyState
              icon={Package}
              title="No models found"
              description="No models match your current filters. Try adjusting the tier or capability filters."
            />
          )}
        </TabsContent>

        {/* Recommended Tab */}
        <TabsContent value="recommended" className="mt-6">
          {isLoading ? (
            renderLoadingGrid()
          ) : filteredRecommendedModels.length > 0 ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Sparkles className="size-4" />
                <p className="text-sm">
                  These models are optimized for your {hardwareInfo?.tier} tier hardware
                </p>
              </div>
              {renderModelGrid(filteredRecommendedModels)}
            </div>
          ) : (
            <EmptyState
              icon={Sparkles}
              title="No recommendations"
              description={
                tierFilter !== 'all' || capabilityFilter !== 'all'
                  ? 'No recommended models match your current filters.'
                  : "We couldn't find recommended models for your hardware configuration."
              }
            />
          )}
        </TabsContent>

        {/* Downloaded Tab */}
        <TabsContent value="downloaded" className="mt-6">
          {isLoadingDownloaded ? (
            renderLoadingGrid()
          ) : filteredDownloadedModels.length > 0 ? (
            renderModelGrid(filteredDownloadedModels)
          ) : (
            <EmptyState
              icon={Download}
              title={
                tierFilter !== 'all' || capabilityFilter !== 'all'
                  ? 'No matching downloads'
                  : 'No models downloaded'
              }
              description={
                tierFilter !== 'all' || capabilityFilter !== 'all'
                  ? 'No downloaded models match your current filters.'
                  : 'Download models from the "All" or "Recommended" tabs to use them for local AI inference.'
              }
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
