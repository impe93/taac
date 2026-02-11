import { type FC, useMemo } from 'react'
import { FileText, Search } from 'lucide-react'
import { Card, CardContent } from '@renderer/components/ui/card'
import { Badge } from '@renderer/components/ui/badge'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { cn } from '@renderer/lib/utils'
import type { RankedResult } from '@main/ai/types'

interface SearchResultsProps {
  results: RankedResult[]
  onSelectNote: (noteId: string) => void
  isLoading?: boolean
  query?: string
  className?: string
}

interface HighlightedTextProps {
  text: string
  query?: string
}

/**
 * Highlights query terms in text by wrapping matches in <mark> elements
 */
const HighlightedText: FC<HighlightedTextProps> = ({ text, query }) => {
  if (!query || query.trim().length === 0) {
    return <>{text}</>
  }

  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 2)

  if (terms.length === 0) {
    return <>{text}</>
  }

  const pattern = new RegExp(`(${terms.map(escapeRegex).join('|')})`, 'gi')
  const parts = text.split(pattern)

  return (
    <>
      {parts.map((part, i) => {
        const isMatch = terms.some((term) => part.toLowerCase() === term.toLowerCase())
        return isMatch ? (
          <mark key={i} className="bg-yellow-200 dark:bg-yellow-800/50 rounded-sm px-0.5">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      })}
    </>
  )
}

/**
 * Escapes special regex characters in a string
 */
const escapeRegex = (str: string): string => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Converts RRF score to a relevance percentage (0-100).
 * Receives a pre-computed maxRrfScore for normalization.
 */
const rrfScoreToRelevance = (rrfScore: number, maxRrfScore: number): number => {
  if (maxRrfScore <= 0) return 0
  return Math.round((rrfScore / maxRrfScore) * 100)
}

/**
 * Returns badge variant based on relevance score
 */
const getRelevanceBadgeVariant = (relevance: number): 'default' | 'secondary' | 'outline' => {
  if (relevance >= 70) return 'default'
  if (relevance >= 50) return 'secondary'
  return 'outline'
}

/**
 * Skeleton loader for search results
 */
const SearchResultsSkeleton: FC = () => (
  <div className="flex flex-col gap-2 p-2">
    {[1, 2, 3].map((i) => (
      <Card key={i} className="py-3">
        <CardContent className="p-0 px-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-3/4" />
            </div>
            <Skeleton className="h-5 w-12 rounded-md" />
          </div>
        </CardContent>
      </Card>
    ))}
  </div>
)

/**
 * Empty state when no results are found
 */
const EmptyState: FC = () => (
  <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
    <div className="rounded-full bg-muted p-3 mb-4">
      <Search className="size-6 text-muted-foreground" />
    </div>
    <p className="text-sm font-medium text-foreground">No results found</p>
    <p className="text-xs text-muted-foreground mt-1">
      Try adjusting your search query or index more notes
    </p>
  </div>
)

/**
 * Single search result item
 */
interface ResultItemProps {
  result: RankedResult
  query?: string
  onSelect: (noteId: string) => void
  maxRrfScore: number
}

const ResultItem: FC<ResultItemProps> = ({ result, query, onSelect, maxRrfScore }) => {
  const { noteId, content, metadata } = result

  const title = useMemo(() => {
    if (metadata?.title && typeof metadata.title === 'string') {
      return metadata.title
    }
    if (metadata?.noteTitle && typeof metadata.noteTitle === 'string') {
      return metadata.noteTitle
    }
    return 'Untitled Note'
  }, [metadata])

  const relevance = rrfScoreToRelevance(result.rrfScore, maxRrfScore)
  const badgeVariant = getRelevanceBadgeVariant(relevance)

  // Truncate content to ~150 characters for snippet
  const snippet = useMemo(() => {
    const maxLength = 150
    if (content.length <= maxLength) return content
    return content.slice(0, maxLength).trim() + '...'
  }, [content])

  const handleClick = (): void => {
    onSelect(noteId)
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect(noteId)
    }
  }

  return (
    <Card
      className="py-3 cursor-pointer transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-label={`Open note: ${title}`}
    >
      <CardContent className="p-0 px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {/* Title */}
            <div className="flex items-center gap-2 mb-1">
              <FileText className="size-4 text-muted-foreground shrink-0" />
              <span className="font-medium text-sm truncate">{title}</span>
            </div>

            {/* Content snippet with highlights */}
            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
              <HighlightedText text={snippet} query={query} />
            </p>
          </div>

          {/* Relevance badge */}
          <Badge variant={badgeVariant} className="shrink-0 text-xs tabular-nums">
            {relevance}%
          </Badge>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * SearchResults component for displaying vector search results in the AI chat
 *
 * Features:
 * - Displays search results with note title, content snippet, and relevance score
 * - Highlights query terms in content snippets
 * - Click to navigate to note
 * - Loading skeleton state
 * - Empty state when no results
 */
export const SearchResults: FC<SearchResultsProps> = ({
  results,
  onSelectNote,
  isLoading = false,
  query,
  className
}) => {
  const maxRrfScore = useMemo(
    () => (results.length > 0 ? Math.max(...results.map((r) => r.rrfScore)) : 0),
    [results]
  )

  if (isLoading) {
    return (
      <div className={cn('w-full', className)}>
        <SearchResultsSkeleton />
      </div>
    )
  }

  if (results.length === 0) {
    return (
      <div className={cn('w-full', className)}>
        <EmptyState />
      </div>
    )
  }

  return (
    <ScrollArea className={cn('w-full', className)}>
      <div className="flex flex-col gap-2 p-2">
        {results.map((result) => (
          <ResultItem
            key={result.id}
            result={result}
            query={query}
            onSelect={onSelectNote}
            maxRrfScore={maxRrfScore}
          />
        ))}
      </div>
    </ScrollArea>
  )
}
