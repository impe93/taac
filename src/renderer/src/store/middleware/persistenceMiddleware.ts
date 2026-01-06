import type { Middleware } from '@reduxjs/toolkit'
import type { NotesTreeState, SpaceTreeState } from '../slices/notesTreeSlice'
import type { FolderMetadata, Note } from '@preload/types'

// Type alias per la struttura della cache multi-spazio
type SpacesCacheStructure = Record<
  string,
  {
    tree: {
      folders: Record<string, FolderMetadata>
      notes: Record<string, Note>
    }
    ui: {
      expandedFolders: string[]
      selectedNoteId: string | null
      selectedNoteFolderId: string | null
    }
    metadata: {
      lastSaved: string
      version: number
    }
  }
>

/**
 * Azioni che triggherano il salvataggio di UI state in electron-store.
 * Modificano expandedFolders, selectedNoteId, selectedNoteFolderId dello spazio attivo.
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
  'notesTree/deleteFolder/fulfilled',
  'notesTree/moveNote/fulfilled',
  'notesTree/moveFolder/fulfilled',
  'notesTree/hydrateAllSpacesFromCache'
] as const

/**
 * Middleware per sincronizzare lo stato Redux multi-spazio con electron-store
 *
 * Persiste tutto in una singola chiave `reduxSpacesCaches` contenente tutti gli spazi.
 * Ogni spazio ha isolati:
 * 1. Tree data: folders, notes
 * 2. UI State: expandedFolders, selectedNoteId, selectedNoteFolderId
 * 3. Metadata: lastSaved, version
 */
export const persistenceMiddleware: Middleware = (store) => {
  return (next) => (action) => {
    const result = next(action)
    const state = store.getState() as { notesTree: NotesTreeState }

    // Type guard per verificare che action abbia una proprietà type
    if (
      typeof action === 'object' &&
      action !== null &&
      'type' in action &&
      typeof action.type === 'string'
    ) {
      const { activeSpaceId, spaces } = state.notesTree

      // Persisti UI state solo se c'è uno spazio attivo
      if (
        activeSpaceId &&
        PERSISTABLE_UI_ACTIONS.includes(action.type as (typeof PERSISTABLE_UI_ACTIONS)[number])
      ) {
        persistSpaceUIState(activeSpaceId, spaces[activeSpaceId])
      }

      // Persisti tree cache (debounced) solo su azioni che modificano dati
      if (
        PERSISTABLE_TREE_CACHE_ACTIONS.includes(
          action.type as (typeof PERSISTABLE_TREE_CACHE_ACTIONS)[number]
        )
      ) {
        debouncedPersistAllSpaces(spaces)
      }
    }

    return result
  }
}

/**
 * Persiste immediatamente l'UI state dello spazio attivo
 */
async function persistSpaceUIState(
  spaceId: string,
  spaceState: SpaceTreeState | undefined
): Promise<void> {
  if (!spaceState) return

  try {
    // Leggi cache esistente
    const existingCache =
      ((await window.config.get('reduxSpacesCaches')) as SpacesCacheStructure | undefined) || {}

    // Aggiorna UI state dello spazio corrente
    existingCache[spaceId] = {
      ...existingCache[spaceId],
      ui: {
        expandedFolders: spaceState.expandedFolders,
        selectedNoteId: spaceState.selectedNoteId,
        selectedNoteFolderId: spaceState.selectedNoteFolderId
      }
    }

    // Salva cache aggiornata
    await window.config.set('reduxSpacesCaches', existingCache)
  } catch (error) {
    console.error('Error persisting UI state:', error)
  }
}

/**
 * Persiste tutti gli spazi (debounced 1 secondo)
 */
let persistTimer: NodeJS.Timeout | null = null
function debouncedPersistAllSpaces(spaces: Record<string, SpaceTreeState>): void {
  if (persistTimer) clearTimeout(persistTimer)

  persistTimer = setTimeout(async () => {
    try {
      const spacesCache: SpacesCacheStructure = {}

      // Costruisci cache per ogni spazio
      Object.entries(spaces).forEach(([spaceId, spaceState]) => {
        spacesCache[spaceId] = {
          tree: {
            folders: spaceState.folders,
            notes: spaceState.notes
          },
          ui: {
            expandedFolders: spaceState.expandedFolders,
            selectedNoteId: spaceState.selectedNoteId,
            selectedNoteFolderId: spaceState.selectedNoteFolderId
          },
          metadata: {
            lastSaved: new Date().toISOString(),
            version: 1
          }
        }
      })

      await window.config.set('reduxSpacesCaches', spacesCache)
    } catch (error) {
      console.error('Error persisting spaces cache:', error)
    }
  }, 1000) // 1 secondo di debounce
}
