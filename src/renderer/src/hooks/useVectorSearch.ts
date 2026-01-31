import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { SearchResult, IndexingProgress } from '@preload/index.d'

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
    noteTitle: string
  } | null>(null)

  useEffect(() => {
    const unsubscribe = window.ai.onIndexingProgress((data: IndexingProgress) => {
      setProgress({
        current: data.current,
        total: data.total,
        noteTitle: data.noteTitle
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
    SearchResult[],
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
