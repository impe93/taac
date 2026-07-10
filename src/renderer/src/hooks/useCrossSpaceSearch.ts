import { useQuery } from '@tanstack/react-query'
import type { SpaceScopedSearchResult } from '@preload/index.d'
import { useDebounce } from './useDebounce'
import { useEmbeddingModelStatus } from './useVectorSearch'

interface UseCrossSpaceSearchResult {
  results: SpaceScopedSearchResult[]
  isFetching: boolean
  /** True while the (debounced) query is non-empty. */
  hasQuery: boolean
  /** False when the embedding model is missing → search runs title-only. */
  semanticAvailable: boolean
}

/**
 * Cross-space semantic search for the global search modal.
 *
 * Debounces the raw input, then queries the lightweight `ai:searchAllSpaces`
 * handler (embedding + hybrid search + title safety net, no reranker/expansion).
 * Surfaces `semanticAvailable` so the UI can hint when only titles are searched.
 */
export const useCrossSpaceSearch = (query: string): UseCrossSpaceSearchResult => {
  const debouncedQuery = useDebounce(query, 250)
  const trimmed = debouncedQuery.trim()
  const { data: embeddingStatus } = useEmbeddingModelStatus()

  const { data, isFetching } = useQuery<SpaceScopedSearchResult[]>({
    queryKey: ['ai', 'search-all', trimmed],
    queryFn: () => window.ai.searchAllSpaces(trimmed),
    enabled: trimmed.length > 0,
    staleTime: 30_000,
    placeholderData: (previous) => previous
  })

  return {
    results: trimmed.length > 0 ? (data ?? []) : [],
    isFetching: trimmed.length > 0 && isFetching,
    hasQuery: trimmed.length > 0,
    semanticAvailable: embeddingStatus?.isAvailable ?? false
  }
}
