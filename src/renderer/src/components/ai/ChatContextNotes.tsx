import { type FC, useState } from 'react'
import { FileText, X, ChevronDown, ChevronRight, Sparkles } from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { cn } from '@renderer/lib/utils'
import type { SearchResult } from '@preload/index.d'

export interface ContextNote {
  noteId: string
  title: string
  excerpt: string
  relevanceScore: number
}

interface ChatContextNotesProps {
  notes: ContextNote[]
  onRemove: (noteId: string) => void
  onNoteClick?: (noteId: string) => void
  isLoading?: boolean
  className?: string
}

/**
 * Converts cosine distance to a rescaled relevance percentage.
 * nomic-embed-text-v2-moe produces cosine similarities in a compressed range:
 *   ~0.9 for identical, ~0.5-0.7 highly relevant, ~0.3-0.5 relevant, <0.2 noise
 * Rescaled from model's effective range [0.15, 0.55] to [0, 100] for intuitive display.
 */
const distanceToRelevance = (distance: number): number => {
  const similarity = 1 - distance
  const MIN_SIM = 0.15
  const MAX_SIM = 0.55
  const rescaled = ((similarity - MIN_SIM) / (MAX_SIM - MIN_SIM)) * 100
  return Math.round(Math.max(0, Math.min(100, rescaled)))
}

/**
 * Gets badge variant based on relevance score
 */
const getRelevanceBadgeVariant = (score: number): 'default' | 'secondary' | 'outline' => {
  if (score >= 55) return 'default'
  if (score >= 30) return 'secondary'
  return 'outline'
}

/**
 * Transforms SearchResult to ContextNote
 */
export const searchResultToContextNote = (result: SearchResult): ContextNote => ({
  noteId: result.noteId,
  title: (result.metadata?.noteTitle as string) || (result.metadata?.title as string) || 'Untitled',
  excerpt: result.content.slice(0, 200) + (result.content.length > 200 ? '...' : ''),
  relevanceScore: distanceToRelevance(result.distance)
})

/**
 * ChatContextNotes component displays notes used as context for RAG
 *
 * Features:
 * - List of context notes with relevance scores
 * - Click to expand/collapse excerpt
 * - Remove individual notes from context
 * - Loading state support
 */
export const ChatContextNotes: FC<ChatContextNotesProps> = ({
  notes,
  onRemove,
  onNoteClick,
  isLoading,
  className
}) => {
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set())

  const toggleExpand = (noteId: string): void => {
    setExpandedNotes((prev) => {
      const next = new Set(prev)
      if (next.has(noteId)) {
        next.delete(noteId)
      } else {
        next.add(noteId)
      }
      return next
    })
  }

  if (notes.length === 0 && !isLoading) {
    return null
  }

  return (
    <div className={cn('border rounded-lg bg-muted/30', className)}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/50">
        <Sparkles className="size-4 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">Context from notes</span>
        <Badge variant="secondary" className="ml-auto text-xs">
          {notes.length} {notes.length === 1 ? 'note' : 'notes'}
        </Badge>
      </div>

      {/* Notes list */}
      <ScrollArea className="max-h-32">
        <div className="p-2 space-y-1">
          {isLoading ? (
            <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
              <div className="size-3 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" />
              Searching for relevant notes...
            </div>
          ) : (
            notes.map((note) => {
              const isExpanded = expandedNotes.has(note.noteId)

              return (
                <div
                  key={note.noteId}
                  className="group rounded-md border bg-background hover:bg-muted/50 transition-colors"
                >
                  {/* Note header row */}
                  <div className="flex items-center gap-2 px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => toggleExpand(note.noteId)}
                      className="shrink-0 p-0.5 hover:bg-muted rounded"
                    >
                      {isExpanded ? (
                        <ChevronDown className="size-3 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-3 text-muted-foreground" />
                      )}
                    </button>

                    <FileText className="size-3.5 text-muted-foreground shrink-0" />

                    <button
                      type="button"
                      onClick={() => onNoteClick?.(note.noteId)}
                      className={cn(
                        'flex-1 text-left text-xs font-medium truncate',
                        onNoteClick && 'hover:text-primary cursor-pointer'
                      )}
                      disabled={!onNoteClick}
                    >
                      {note.title}
                    </button>

                    <Badge
                      variant={getRelevanceBadgeVariant(note.relevanceScore)}
                      className="text-[10px] px-1.5 py-0 h-4"
                    >
                      {note.relevanceScore}%
                    </Badge>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-5 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => onRemove(note.noteId)}
                    >
                      <X className="size-3" />
                      <span className="sr-only">Remove from context</span>
                    </Button>
                  </div>

                  {/* Expanded excerpt */}
                  {isExpanded && (
                    <div className="px-2 pb-2 pl-8">
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {note.excerpt}
                      </p>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
