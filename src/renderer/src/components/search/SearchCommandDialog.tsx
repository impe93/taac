import { type FC, useCallback, useMemo, useState } from 'react'
import * as Icons from 'lucide-react'
import { FileText, Type } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@renderer/components/ui/command'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { HighlightedText } from '@renderer/lib/highlight'
import { useCrossSpaceSearch } from '@renderer/hooks/useCrossSpaceSearch'
import { useSpaces, useSwitchSpace } from '@renderer/hooks/useSpaces'
import { useAppDispatch, useAppStore } from '@renderer/store/hooks'
import { openTab, selectActiveSpaceId } from '@renderer/store/slices/notesTreeSlice'
import type { SpaceScopedSearchResult } from '@preload/index.d'

interface SearchCommandDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface SpaceGroup {
  spaceId: string
  spaceName: string
  icon: string
  results: SpaceScopedSearchResult[]
}

// Shared cmdk styling, mirrored from ui/command.tsx's CommandDialog wrapper.
const COMMAND_CLASS =
  '[&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2'

const SearchResultsSkeleton: FC = () => (
  <div className="flex flex-col gap-2 p-3">
    {[1, 2, 3].map((i) => (
      <div key={i} className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-full" />
      </div>
    ))}
  </div>
)

/**
 * Global cross-space search modal (⌘K).
 *
 * Real-time, debounced semantic search across every space, with results grouped
 * by space. Selecting a result switches the active space if needed, then opens
 * the note. Ranking runs entirely server-side, so cmdk filtering is disabled.
 */
export const SearchCommandDialog: FC<SearchCommandDialogProps> = ({ open, onOpenChange }) => {
  const [query, setQuery] = useState('')
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const store = useAppStore()
  const { data: spaces } = useSpaces()
  const switchSpace = useSwitchSpace()
  const { results, isFetching, hasQuery, semanticAvailable } = useCrossSpaceSearch(query)

  const iconBySpace = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of spaces ?? []) map.set(s.id, s.icon)
    return map
  }, [spaces])

  // Group results by space; order groups by their strongest result.
  const groups = useMemo<SpaceGroup[]>(() => {
    const map = new Map<string, SpaceGroup>()
    for (const r of results) {
      let group = map.get(r.spaceId)
      if (!group) {
        group = {
          spaceId: r.spaceId,
          spaceName: r.spaceName,
          icon: iconBySpace.get(r.spaceId) ?? 'Home',
          results: []
        }
        map.set(r.spaceId, group)
      }
      group.results.push(r)
    }
    return Array.from(map.values()).sort(
      (a, b) => b.results[0].relevancePercent - a.results[0].relevancePercent
    )
  }, [results, iconBySpace])

  const handleOpenChange = useCallback(
    (next: boolean): void => {
      if (!next) setQuery('')
      onOpenChange(next)
    },
    [onOpenChange]
  )

  const handleSelect = useCallback(
    async (result: SpaceScopedSearchResult): Promise<void> => {
      onOpenChange(false)
      setQuery('')
      const activeSpaceId = selectActiveSpaceId(store.getState())
      // The note route resolves notes from the active space only — switch first
      // (config + Redux active space + lazy tree load) or it renders "Note not found".
      if (result.spaceId !== activeSpaceId) {
        await switchSpace.mutateAsync(result.spaceId)
      }
      dispatch(openTab({ noteId: result.noteId, folderId: result.folderId }))
      navigate({ to: '/note/$noteId', params: { noteId: result.noteId } })
    },
    [dispatch, navigate, onOpenChange, store, switchSpace]
  )

  const showEmpty = hasQuery && !isFetching && results.length === 0

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="sr-only">
          <DialogTitle>Search notes</DialogTitle>
          <DialogDescription>Search across all your spaces</DialogDescription>
        </DialogHeader>
        <Command shouldFilter={false} className={COMMAND_CLASS}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search notes across all spaces…"
          />
          <CommandList className="max-h-[60vh]">
            {!hasQuery && (
              <div className="py-10 text-center text-sm text-muted-foreground">
                Type to search your notes
              </div>
            )}

            {isFetching && results.length === 0 && <SearchResultsSkeleton />}

            {showEmpty && (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No results found
              </div>
            )}

            {groups.map((group) => {
              const SpaceIcon = (Icons[group.icon as keyof typeof Icons] ||
                Icons.Home) as React.ComponentType<{ className?: string }>
              return (
                <CommandGroup
                  key={group.spaceId}
                  heading={
                    <span className="flex items-center gap-1.5">
                      <SpaceIcon className="size-3.5" />
                      {group.spaceName}
                    </span>
                  }
                >
                  {group.results.map((result) => (
                    <CommandItem
                      key={`${result.spaceId}:${result.noteId}`}
                      value={`${result.spaceId}:${result.noteId}`}
                      onSelect={() => handleSelect(result)}
                      className="flex-col items-start gap-1"
                    >
                      <div className="flex w-full items-center gap-2">
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate text-sm font-medium">
                          <HighlightedText text={result.title} query={query} />
                        </span>
                        {result.matchedBy === 'title' && !result.snippet && (
                          <Type className="size-3 shrink-0 text-muted-foreground/60" />
                        )}
                      </div>
                      {result.snippet && (
                        <p className="line-clamp-1 pl-6 text-xs text-muted-foreground">
                          <HighlightedText text={result.snippet} query={query} />
                        </p>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )
            })}
          </CommandList>

          {hasQuery && !semanticAvailable && (
            <div className="border-t px-3 py-2 text-xs text-muted-foreground">
              Semantic search unavailable — searching titles only.
            </div>
          )}
        </Command>
      </DialogContent>
    </Dialog>
  )
}
