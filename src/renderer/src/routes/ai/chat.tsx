import { type ReactNode, useState, useEffect } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Bot, AlertTriangle, Loader2, Settings } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import { Button } from '@renderer/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { ChatInterface } from '@renderer/components/ai/ChatInterface'
import { useDownloadedModels } from '@renderer/hooks/useModels'
import { useAIInitialize, useLoadedModels } from '@renderer/hooks/useAI'
import type { ModelDefinition } from '@main/ai/types'

export const Route = createFileRoute('/ai/chat')({
  component: AIChatPage
})

interface ModelSelectorProps {
  models: ModelDefinition[]
  selectedModelId: string | null
  onModelSelect: (modelId: string) => void
}

function ModelSelector({ models, selectedModelId, onModelSelect }: ModelSelectorProps): ReactNode {
  return (
    <Select value={selectedModelId ?? undefined} onValueChange={onModelSelect}>
      <SelectTrigger className="w-[280px]">
        <SelectValue placeholder="Select a model" />
      </SelectTrigger>
      <SelectContent>
        {models.map((model) => (
          <SelectItem key={model.id} value={model.id}>
            <div className="flex items-center gap-2">
              <Bot className="size-4" />
              <span>{model.name}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function NoModelsMessage(): ReactNode {
  const navigate = useNavigate()

  const handleGoToSettings = (): void => {
    navigate({ to: '/settings/ai' })
  }

  return (
    <div className="flex flex-col items-center justify-center h-full p-8">
      <div className="rounded-full bg-muted p-4 mb-4">
        <Bot className="size-8 text-muted-foreground" />
      </div>
      <h2 className="text-xl font-semibold mb-2">No AI Models Downloaded</h2>
      <p className="text-muted-foreground text-center max-w-md mb-6">
        To use the AI chat, you need to download at least one model. Head to the AI settings to
        browse and download available models.
      </p>
      <Button onClick={handleGoToSettings} className="gap-2">
        <Settings className="size-4" />
        Go to AI Settings
      </Button>
    </div>
  )
}

interface ModelNotLoadedWarningProps {
  modelId: string
  isLoadingModel: boolean
  onLoadModel: () => void
}

function ModelNotLoadedWarning({
  modelId,
  isLoadingModel,
  onLoadModel
}: ModelNotLoadedWarningProps): ReactNode {
  return (
    <Alert className="mb-4">
      <AlertTriangle className="size-4" />
      <AlertTitle>Model not loaded</AlertTitle>
      <AlertDescription className="flex items-center justify-between">
        <span>
          The model <strong>{modelId}</strong> is not currently loaded in memory. Loading may take
          some time depending on the model size and your hardware.
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={onLoadModel}
          disabled={isLoadingModel}
          className="ml-4 shrink-0"
        >
          {isLoadingModel ? (
            <>
              <Loader2 className="size-4 mr-2 animate-spin" />
              Loading...
            </>
          ) : (
            'Load Model'
          )}
        </Button>
      </AlertDescription>
    </Alert>
  )
}

function AIChatPage(): ReactNode {
  const navigate = useNavigate()
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)

  // AI initialization
  const { isInitialized, isCheckingInitialized, initialize, isInitializing } = useAIInitialize()

  // Downloaded models query
  const { data: downloadedModels, isLoading: isLoadingDownloadedModels } = useDownloadedModels()

  // Loaded models query
  const { loadedModels, loadModel, isLoadingModel } = useLoadedModels()

  // Initialize AI if not initialized
  useEffect(() => {
    if (!isCheckingInitialized && !isInitialized && !isInitializing) {
      initialize()
    }
  }, [isCheckingInitialized, isInitialized, isInitializing, initialize])

  // Auto-select first model if none selected
  useEffect(() => {
    if (!selectedModelId && downloadedModels && downloadedModels.length > 0) {
      setSelectedModelId(downloadedModels[0].id)
    }
  }, [selectedModelId, downloadedModels])

  // Check if selected model is loaded
  const isModelLoaded = selectedModelId ? loadedModels.some((m) => m.id === selectedModelId) : false

  const handleLoadModel = (): void => {
    if (selectedModelId) {
      loadModel(selectedModelId)
    }
  }

  // Loading state
  if (isLoadingDownloadedModels || isCheckingInitialized) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <Loader2 className="size-8 animate-spin text-muted-foreground mb-4" />
        <p className="text-muted-foreground">Loading AI...</p>
      </div>
    )
  }

  // Initializing state
  if (isInitializing) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <Loader2 className="size-8 animate-spin text-muted-foreground mb-4" />
        <p className="text-muted-foreground">Initializing AI engine...</p>
      </div>
    )
  }

  // No models downloaded
  if (!downloadedModels || downloadedModels.length === 0) {
    return <NoModelsMessage />
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with model selector */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">AI Chat</h1>
        </div>
        <div className="flex items-center gap-2">
          <ModelSelector
            models={downloadedModels}
            selectedModelId={selectedModelId}
            onModelSelect={setSelectedModelId}
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate({ to: '/settings/ai' })}
            title="AI Settings"
          >
            <Settings className="size-4" />
          </Button>
        </div>
      </div>

      {/* Warning if model not loaded */}
      {selectedModelId && !isModelLoaded && (
        <div className="px-4 pt-4">
          <ModelNotLoadedWarning
            modelId={selectedModelId}
            isLoadingModel={isLoadingModel}
            onLoadModel={handleLoadModel}
          />
        </div>
      )}

      {/* Chat interface */}
      {selectedModelId && (
        <div className="flex-1 min-h-0">
          <ChatInterface modelId={selectedModelId} className="h-full w-full" />
        </div>
      )}
    </div>
  )
}
