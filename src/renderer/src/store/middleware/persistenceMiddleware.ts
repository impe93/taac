import type { Middleware, MiddlewareAPI } from '@reduxjs/toolkit'

/**
 * Middleware per sincronizzare lo stato Redux con electron-store
 *
 * Persiste:
 * 1. UI State: expandedFolders, selectedNoteId, selectedNoteFolderId
 * 2. Tree Cache: folders, notes (per caricamento veloce)
 */
export const persistenceMiddleware: Middleware = (store: MiddlewareAPI) => {
  // Setup listener per cambiamenti da electron-store
  if (typeof window !== 'undefined' && window.config) {
    // Ascolta cambiamenti da altre finestre o main process
    window.config.onChange('reduxUIState', (newValue) => {
      if (newValue) {
        store.dispatch({ type: 'notesTree/hydrateUIState', payload: newValue })
      }
    })
  }

  return (next) => (action: unknown) => {
    const result = next(action)
    const state = store.getState() as {
      notesTree: {
        folders: Record<string, unknown>
        notes: Record<string, unknown>
        expandedFolders: string[]
        selectedNoteId: string | null
        selectedNoteFolderId: string | null
      }
    }

    // Dopo ogni action, persisti lo stato rilevante
    if (
      typeof action === 'object' &&
      action !== null &&
      'type' in action &&
      typeof action.type === 'string' &&
      action.type.startsWith('notesTree/')
    ) {
      // Persisti UI state
      const uiState = {
        expandedFolders: state.notesTree.expandedFolders,
        selectedNoteId: state.notesTree.selectedNoteId,
        selectedNoteFolderId: state.notesTree.selectedNoteFolderId
      }

      // Usa window.config per persistere (async, non blocca)
      window.config.set('reduxUIState', uiState).catch(console.error)

      // Persisti tree cache (throttled per performance)
      // Solo su azioni che modificano i dati, non l'UI
      const dataModifyingActions = [
        'notesTree/loadTree/fulfilled',
        'notesTree/createNote/fulfilled',
        'notesTree/updateNote/fulfilled',
        'notesTree/deleteNote/fulfilled',
        'notesTree/createFolder/fulfilled',
        'notesTree/updateFolder/fulfilled',
        'notesTree/deleteFolder/fulfilled'
      ]

      if (dataModifyingActions.includes(action.type)) {
        // Persisti cache del tree (debounced)
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
