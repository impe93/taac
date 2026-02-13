import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, useCallback } from 'react'
import type { ExpandedResult, IndexingProgress, EmbeddingModelStatus } from '@preload/index.d'
import { useModelDownload } from './useModels'

/**
 * Query list of indexed note IDs for a space
 */
export const useIndexedNotes = (spaceId: string) => {
  return useQuery<string[]>({
    queryKey: ['ai', 'indexed', spaceId],
    queryFn: () => window.ai.getIndexedNotes(spaceId),
    enabled: !!spaceId
  })
}

/**
 * Mutation to index a single note
 */
export const useIndexNote = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      spaceId,
      noteId,
      folderId
    }: {
      spaceId: string
      noteId: string
      folderId: string
    }) => window.ai.indexNote(spaceId, noteId, folderId),
    onSuccess: (_, { spaceId }) => {
      queryClient.invalidateQueries({
        queryKey: ['ai', 'indexed', spaceId]
      })
    }
  })
}

/**
 * Hook for indexing all notes in a space with progress tracking
 *
 * Features:
 * - Real-time progress updates via IPC events
 * - Progress state with current, total, and noteTitle
 * - Automatic query invalidation on completion
 */
export const useIndexAllNotes = (spaceId: string) => {
  const queryClient = useQueryClient()
  const [progress, setProgress] = useState<{
    current: number
    total: number
    noteTitle: string | null
    status: 'checking' | 'indexing' | 'complete'
    staleCount?: number
  } | null>(null)

  useEffect(() => {
    const unsubscribe = window.ai.onIndexingProgress((data: IndexingProgress) => {
      setProgress({
        current: data.current,
        total: data.total,
        noteTitle: data.noteTitle,
        status: data.status,
        staleCount: data.staleCount
      })
    })

    return unsubscribe
  }, [])

  const mutation = useMutation({
    mutationFn: () => window.ai.indexAllNotes(spaceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai', 'indexed', spaceId] })
      setProgress(null)
    },
    onError: () => {
      setProgress(null)
    }
  })

  return {
    indexAll: mutation.mutate,
    indexAllAsync: mutation.mutateAsync,
    isIndexing: mutation.isPending,
    progress
  }
}

/**
 * Mutation for semantic search in notes
 */
export const useVectorSearch = (spaceId: string) => {
  return useMutation<
    ExpandedResult[],
    Error,
    {
      query: string
      limit?: number
      noteIds?: string[]
    }
  >({
    mutationFn: ({ query, limit, noteIds }) => window.ai.searchNotes(spaceId, query, limit, noteIds)
  })
}

/**
 * Mutation to remove a note from the vector index
 */
export const useDeleteNoteIndex = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ spaceId, noteId }: { spaceId: string; noteId: string }) =>
      window.ai.deleteNoteIndex(spaceId, noteId),
    onSuccess: (_, { spaceId }) => {
      queryClient.invalidateQueries({
        queryKey: ['ai', 'indexed', spaceId]
      })
    }
  })
}

/**
 * Query embedding model status for RAG operations
 * Returns whether the default embedding model is available
 */
export const useEmbeddingModelStatus = () => {
  return useQuery<EmbeddingModelStatus>({
    queryKey: ['ai', 'embedding', 'status'],
    queryFn: () => window.ai.getEmbeddingModelStatus(),
    staleTime: 30_000 // Cache for 30 seconds
  })
}

/**
 * Hook to ensure embedding model is available for RAG
 * Combines status query with download capability
 */
export const useEnsureEmbeddingModel = () => {
  const queryClient = useQueryClient()
  const { data: status, isLoading, refetch } = useEmbeddingModelStatus()
  const { download, progress, isDownloading } = useModelDownload()

  const downloadEmbeddingModel = useCallback(() => {
    if (status?.modelId) {
      download(status.modelId)
    }
  }, [status?.modelId, download])

  // Invalidate status when download completes
  useEffect(() => {
    if (status?.modelId) {
      const modelProgress = progress.get(status.modelId)
      if (modelProgress?.status === 'completed') {
        queryClient.invalidateQueries({ queryKey: ['ai', 'embedding', 'status'] })
      }
    }
  }, [progress, status?.modelId, queryClient])

  return {
    isAvailable: status?.isAvailable ?? false,
    isLoading,
    modelName: status?.modelName ?? 'Embedding Model',
    modelId: status?.modelId,
    sizeBytes: status?.sizeBytes,
    error: status?.error,
    downloadEmbeddingModel,
    isDownloading,
    downloadProgress: status?.modelId ? progress.get(status.modelId) : undefined,
    refetch
  }
}
