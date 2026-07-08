import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import type { LoadedModel, ChatCompletionResult, GenerationOptions } from '@main/ai/types'

/**
 * Hook for AI initialization with mutation and state query
 *
 * Features:
 * - Mutation to trigger initialization
 * - Query to check current initialization state
 * - Automatic query invalidation after initialization
 */
export const useAIInitialize = () => {
  const queryClient = useQueryClient()

  const initializeQuery = useQuery<boolean>({
    queryKey: ['ai', 'initialized'],
    queryFn: () => window.ai.isInitialized(),
    staleTime: Infinity
  })

  const initializeMutation = useMutation({
    mutationFn: () => window.ai.initialize(),
    onSuccess: (data) => {
      queryClient.setQueryData(['ai', 'initialized'], true)
      if (data?.gpuFallback) {
        toast.warning('GPU acceleration unavailable', {
          description: 'The AI model will run in CPU mode. Performance may be reduced.'
        })
      }
    },
    onError: (error) => {
      toast.error('AI initialization failed', {
        description: (error as Error)?.message ?? 'Unknown error'
      })
    }
  })

  return {
    isInitialized: initializeQuery.data ?? false,
    isCheckingInitialized: initializeQuery.isLoading,
    initialize: () => {
      initializeMutation.reset()
      initializeMutation.mutate()
    },
    initializeAsync: initializeMutation.mutateAsync,
    isInitializing: initializeMutation.isPending,
    initializeError: initializeMutation.error
  }
}

/**
 * Query for currently loaded models with automatic polling
 *
 * Features:
 * - Polls every 5 seconds to detect model state changes
 * - Includes mutations for loading/unloading models
 */
export const useLoadedModels = () => {
  const queryClient = useQueryClient()

  const loadedModelsQuery = useQuery<LoadedModel[]>({
    queryKey: ['ai', 'models', 'loaded'],
    queryFn: () => window.ai.getLoadedModels(),
    refetchInterval: 5000
  })

  const loadModelMutation = useMutation({
    mutationFn: (modelId: string) => window.ai.loadModel(modelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai', 'models', 'loaded'] })
    },
    onError: (error) => {
      toast.error('Failed to load model', {
        description: (error as Error)?.message ?? 'Unknown error'
      })
    }
  })

  const unloadModelMutation = useMutation({
    mutationFn: (modelId: string) => window.ai.unloadModel(modelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai', 'models', 'loaded'] })
    }
  })

  return {
    loadedModels: loadedModelsQuery.data ?? [],
    isLoadingModels: loadedModelsQuery.isLoading,
    isRefetching: loadedModelsQuery.isRefetching,
    loadModel: loadModelMutation.mutate,
    loadModelAsync: loadModelMutation.mutateAsync,
    isLoadingModel: loadModelMutation.isPending,
    unloadModel: unloadModelMutation.mutate,
    unloadModelAsync: unloadModelMutation.mutateAsync,
    isUnloadingModel: unloadModelMutation.isPending
  }
}

/**
 * Chat message type for sending to the AI
 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

/**
 * Hook for AI chat with streaming support
 *
 * Features:
 * - Real-time streaming via onResponseChunk subscription
 * - currentResponse updates on each chunk for live UI
 * - sendMessage returns the final complete response
 *
 * @param modelId - The model ID to use for generation
 */
export const useAIChat = (modelId: string) => {
  const [isGenerating, setIsGenerating] = useState(false)
  const [currentResponse, setCurrentResponse] = useState('')
  // Accumulated reasoning ("thought") text for the in-flight generation, streamed
  // separately from the answer so the UI can show a collapsible thinking panel.
  const [currentThought, setCurrentThought] = useState('')

  useEffect(() => {
    const unsubscribe = window.ai.onResponseChunk(({ fullResponse, kind, fullThought }) => {
      if (kind === 'thought') {
        if (fullThought !== undefined) setCurrentThought(fullThought)
        return
      }
      setCurrentResponse(fullResponse)
    })

    return unsubscribe
  }, [])

  const abortGeneration = useCallback(async (): Promise<void> => {
    await window.ai.stopGeneration()
  }, [])

  const sendMessage = useCallback(
    async (
      messages: ChatMessage[],
      options?: Pick<GenerationOptions, 'maxTokens' | 'temperature' | 'repeatPenalty' | 'rag'>
    ): Promise<{ response: string; aborted?: boolean }> => {
      setIsGenerating(true)
      setCurrentResponse('')
      setCurrentThought('')

      try {
        const result: ChatCompletionResult = await window.ai.generateResponse(
          modelId,
          messages,
          options
        )
        if (result.aborted) {
          return { response: '', aborted: true }
        }
        return { response: result.response }
      } finally {
        setIsGenerating(false)
        setCurrentResponse('')
        setCurrentThought('')
      }
    },
    [modelId]
  )

  return {
    sendMessage,
    abortGeneration,
    isGenerating,
    currentResponse,
    currentThought
  }
}
