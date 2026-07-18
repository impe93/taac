import { useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useAppDispatch, useAppSelector, useAppStore } from '@renderer/store/hooks'
import {
  selectOpenTabs,
  selectActiveSpaceState,
  openTab as openTabAction,
  closeTab as closeTabAction,
  reorderTabs as reorderTabsAction
} from '@renderer/store/slices/notesTreeSlice'

export interface UseNoteTabsResult {
  openTabs: string[]
  activeNoteId: string | null
  focusTab: (noteId: string) => void
  closeTab: (noteId: string) => void
  reorder: (orderedIds: string[]) => void
  focusIndex: (index: number) => void
  focusNext: () => void
  focusPrev: () => void
  closeActive: () => void
}

/**
 * Logica condivisa della barra schede: selettori + handler che dispatchano su Redux
 * e mantengono la navigazione TanStack Router coerente con il focus (selectedNoteId).
 */
export function useNoteTabs(): UseNoteTabsResult {
  const dispatch = useAppDispatch()
  const store = useAppStore()
  const navigate = useNavigate()
  const openTabs = useAppSelector(selectOpenTabs)
  const activeNoteId = useAppSelector(
    (state) => selectActiveSpaceState(state)?.selectedNoteId ?? null
  )

  const navigateToNote = useCallback(
    (noteId: string | null): void => {
      if (noteId) {
        navigate({ to: '/note/$noteId', params: { noteId } })
      } else {
        navigate({ to: '/' })
      }
    },
    [navigate]
  )

  const focusTab = useCallback(
    (noteId: string): void => {
      const space = selectActiveSpaceState(store.getState())
      const folderId = space?.notes[noteId]?.folderId ?? space?.selectedNoteFolderId ?? 'root'
      dispatch(openTabAction({ noteId, folderId }))
      navigateToNote(noteId)
    },
    [dispatch, store, navigateToNote]
  )

  const closeTab = useCallback(
    (noteId: string): void => {
      dispatch(closeTabAction({ noteId }))
      // Dopo la chiusura il reducer ha già aggiornato il focus: naviga di conseguenza.
      const nextFocus = selectActiveSpaceState(store.getState())?.selectedNoteId ?? null
      navigateToNote(nextFocus)
    },
    [dispatch, store, navigateToNote]
  )

  const reorder = useCallback(
    (orderedIds: string[]): void => {
      dispatch(reorderTabsAction({ orderedIds }))
    },
    [dispatch]
  )

  const focusIndex = useCallback(
    (index: number): void => {
      const tabs = selectOpenTabs(store.getState())
      // index 8 (⌘9) convenzione: ultima scheda
      const target = index >= tabs.length ? tabs[tabs.length - 1] : tabs[index]
      if (target) focusTab(target)
    },
    [store, focusTab]
  )

  const focusRelative = useCallback(
    (delta: number): void => {
      const tabs = selectOpenTabs(store.getState())
      if (tabs.length === 0) return
      const current = selectActiveSpaceState(store.getState())?.selectedNoteId ?? null
      const currentIndex = current ? tabs.indexOf(current) : -1
      const base = currentIndex === -1 ? 0 : currentIndex
      const nextIndex = (base + delta + tabs.length) % tabs.length
      focusTab(tabs[nextIndex])
    },
    [store, focusTab]
  )

  const focusNext = useCallback(() => focusRelative(1), [focusRelative])
  const focusPrev = useCallback(() => focusRelative(-1), [focusRelative])

  const closeActive = useCallback(() => {
    const current = selectActiveSpaceState(store.getState())?.selectedNoteId ?? null
    if (current) closeTab(current)
  }, [store, closeTab])

  return {
    openTabs,
    activeNoteId,
    focusTab,
    closeTab,
    reorder,
    focusIndex,
    focusNext,
    focusPrev,
    closeActive
  }
}
