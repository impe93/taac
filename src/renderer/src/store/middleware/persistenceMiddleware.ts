import type { Middleware } from '@reduxjs/toolkit'

/**
 * Azioni che triggherano il salvataggio di UI state in electron-store.
 * Solo azioni sincrone che modificano expandedFolders, selectedNoteId, selectedNoteFolderId.
 */
const PERSISTABLE_UI_ACTIONS = [
  'notesTree/toggleFolder',
  'notesTree/expandFolder',
  'notesTree/collapseFolder',
  'notesTree/selectNote',
  'notesTree/clearSelection'
] as const

/**
 * Azioni che triggherano il salvataggio di tree cache (folders/notes) in electron-store.
 * Debounced a 1 secondo per evitare scritture eccessive.
 */
const PERSISTABLE_TREE_CACHE_ACTIONS = [
  'notesTree/loadTree/fulfilled',
  'notesTree/createNote/fulfilled',
  'notesTree/updateNote/fulfilled',
  'notesTree/deleteNote/fulfilled',
  'notesTree/createFolder/fulfilled',
  'notesTree/updateFolder/fulfilled',
  'notesTree/deleteFolder/fulfilled'
] as const

/**
 * Middleware per sincronizzare lo stato Redux con electron-store
 *
 * Persiste:
 * 1. UI State: expandedFolders, selectedNoteId, selectedNoteFolderId
 * 2. Tree Cache: folders, notes (per caricamento veloce)
 */
export const persistenceMiddleware: Middleware = (store) => {
  // Setup listener per cambiamenti da electron-store
  if (typeof window !== 'undefined' && window.config) {
    // Ascolta cambiamenti da altre finestre o main process
    window.config.onChange('reduxUIState', (newValue) => {
      if (newValue) {
        store.dispatch({ type: 'notesTree/hydrateUIState', payload: newValue })
      }
    })
  }

  return (next) => (action) => {
    const result = next(action)
    const state = store.getState()

    // Type guard per verificare che action abbia una proprietà type
    if (
      typeof action === 'object' &&
      action !== null &&
      'type' in action &&
      typeof action.type === 'string'
    ) {
      // Persisti UI state solo su azioni che modificano UI
      if (PERSISTABLE_UI_ACTIONS.includes(action.type as (typeof PERSISTABLE_UI_ACTIONS)[number])) {
        const uiState = {
          expandedFolders: state.notesTree.expandedFolders,
          selectedNoteId: state.notesTree.selectedNoteId,
          selectedNoteFolderId: state.notesTree.selectedNoteFolderId
        }

        // Scrittura immediata (no debouncing per UI state)
        window.config.set('reduxUIState', uiState).catch(console.error)
      }

      // Persisti tree cache (debounced) solo su azioni che modificano dati
      if (
        PERSISTABLE_TREE_CACHE_ACTIONS.includes(
          action.type as (typeof PERSISTABLE_TREE_CACHE_ACTIONS)[number]
        )
      ) {
        debouncedPersistTreeCache(state.notesTree.folders, state.notesTree.notes)
      }
    }

    return result
  }
}

// Debounce per evitare troppe scritture
let persistTimer: NodeJS.Timeout | null = null
function debouncedPersistTreeCache(
  folders: Record<string, unknown>,
  notes: Record<string, unknown>
): void {
  if (persistTimer) clearTimeout(persistTimer)

  persistTimer = setTimeout(() => {
    window.config.set('reduxTreeCache', { folders, notes }).catch(console.error)
  }, 1000) // 1 secondo di debounce
}
