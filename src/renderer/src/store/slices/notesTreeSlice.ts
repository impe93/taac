import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit'
import type { Note, FolderMetadata } from '@preload/types'
import type { SerializedEditorState } from 'lexical'

// ============================================================================
// STATE INTERFACE
// ============================================================================

// State per ogni singolo spazio (tree data + UI state isolati)
export interface SpaceTreeState {
  // DATI (normalizzati)
  folders: Record<string, FolderMetadata> // { [folderId]: FolderMetadata }
  notes: Record<string, Note> // { [noteId]: Note }
  rootFolderId: string // 'root'

  // UI STATE
  expandedFolders: string[] // Folder IDs espansi
  selectedNoteId: string | null // Nota selezionata
  selectedNoteFolderId: string | null // Folder contenente la nota selezionata

  // PERSISTENCE (per-spazio)
  isCacheHydrated: boolean // true dopo hydration del cache
  isFullyHydrated: boolean // true dopo reconciliazione con filesystem
}

// State globale che contiene tutti gli spazi
export interface NotesTreeState {
  // Multi-space storage: { [spaceId]: SpaceTreeState }
  spaces: Record<string, SpaceTreeState>

  // Active space reference
  activeSpaceId: string | null

  // LOADING & ERROR STATE (globali)
  loading: boolean // Loading generale
  loadingOperations: Record<string, boolean> // { 'createNote-folderId': true }
  error: string | null

  // DEPRECATED: mantenuto per backward compatibility
  isHydrated: boolean
}

// Helper per creare uno spazio vuoto
function createEmptySpaceState(): SpaceTreeState {
  return {
    folders: {},
    notes: {},
    rootFolderId: 'root',
    expandedFolders: ['root'],
    selectedNoteId: null,
    selectedNoteFolderId: null,
    isCacheHydrated: false,
    isFullyHydrated: false
  }
}

const initialState: NotesTreeState = {
  spaces: {},
  activeSpaceId: null,
  loading: false,
  loadingOperations: {},
  error: null,
  isHydrated: false
}

// ============================================================================
// ASYNC THUNKS (chiamate IPC)
// ============================================================================

// Carica l'intero tree all'avvio
export const loadTree = createAsyncThunk(
  'notesTree/loadTree',
  async (payload: { spaceId: string }) => {
    const { spaceId } = payload

    // Ricorsivamente carica tutte le cartelle e note
    const loadFolderRecursive = async (
      folderId: string
    ): Promise<{
      folders: Record<string, FolderMetadata>
      notes: Record<string, Note>
    }> => {
      const folderMeta = await window.fileSystem.readFolderMetadata(spaceId, folderId)
      const notes = await window.fileSystem.listNotes(spaceId, folderId)

      let allFolders: Record<string, FolderMetadata> = { [folderId]: folderMeta }
      let allNotes: Record<string, Note> = {}

      // Carica note
      for (const note of notes) {
        allNotes[note.id] = note
      }

      // Carica ricorsivamente child folders
      for (const childId of folderMeta.children) {
        const childData = await loadFolderRecursive(childId)
        allFolders = { ...allFolders, ...childData.folders }
        allNotes = { ...allNotes, ...childData.notes }
      }

      return { folders: allFolders, notes: allNotes }
    }

    const { folders, notes } = await loadFolderRecursive('root')
    return { spaceId, folders, notes }
  }
)

// Crea nota
export const createNote = createAsyncThunk(
  'notesTree/createNote',
  async (payload: {
    spaceId: string
    folderId: string
    title: string
    content: SerializedEditorState
  }) => {
    const { spaceId, folderId, title, content } = payload

    const note = await window.fileSystem.createNote(spaceId, folderId, content, title)
    return { spaceId, note, folderId }
  }
)

// Aggiorna nota
export const updateNote = createAsyncThunk(
  'notesTree/updateNote',
  async (payload: {
    spaceId: string
    folderId: string
    noteId: string
    updates: Partial<Note>
  }) => {
    const { spaceId, folderId, noteId, updates } = payload

    const note = await window.fileSystem.updateNote(spaceId, folderId, noteId, updates)
    return { spaceId, note }
  }
)

// Elimina nota
export const deleteNote = createAsyncThunk(
  'notesTree/deleteNote',
  async (payload: { spaceId: string; folderId: string; noteId: string }) => {
    const { spaceId, folderId, noteId } = payload

    await window.fileSystem.deleteNote(spaceId, folderId, noteId)
    return { spaceId, noteId, folderId }
  }
)

// Crea cartella
export const createFolder = createAsyncThunk(
  'notesTree/createFolder',
  async (payload: { spaceId: string; name: string; parentId: string }) => {
    const { spaceId, name, parentId } = payload

    const folder = await window.fileSystem.createFolder(spaceId, name, parentId)
    return { spaceId, folder, parentId }
  }
)

// Aggiorna cartella
export const updateFolder = createAsyncThunk(
  'notesTree/updateFolder',
  async (payload: { spaceId: string; folderId: string; updates: Partial<FolderMetadata> }) => {
    const { spaceId, folderId, updates } = payload

    const folder = await window.fileSystem.updateFolderMetadata(spaceId, folderId, updates)
    return { spaceId, folder }
  }
)

// Elimina cartella (ricorsivo)
export const deleteFolder = createAsyncThunk(
  'notesTree/deleteFolder',
  async (payload: { spaceId: string; folderId: string }) => {
    const { spaceId, folderId } = payload

    await window.fileSystem.deleteFolder(spaceId, folderId)
    return { spaceId, folderId }
  }
)

// ============================================================================
// SLICE
// ============================================================================

const notesTreeSlice = createSlice({
  name: 'notesTree',
  initialState,
  reducers: {
    // DEPRECATED: Hydrate UI state (mantenuto per backward compatibility)
    hydrateUIState: (
      state,
      _action: PayloadAction<{
        expandedFolders: string[]
        selectedNoteId: string | null
        selectedNoteFolderId: string | null
      }>
    ) => {
      // Questa azione è deprecated ma mantenuta per compatibilità
      state.isHydrated = true
    },

    // DEPRECATED: Hydrate completo (mantenuto per backward compatibility)
    hydrateFromCache: (
      state,
      _action: PayloadAction<{
        folders: Record<string, FolderMetadata>
        notes: Record<string, Note>
        uiState: {
          expandedFolders: string[]
          selectedNoteId: string | null
          selectedNoteFolderId: string | null
        }
      }>
    ) => {
      // Questa azione è deprecated ma mantenuta per compatibilità
      state.isHydrated = true
    },

    // Hydrate tutti gli spazi da cache all'avvio
    hydrateAllSpacesFromCache: (
      state,
      action: PayloadAction<{
        spacesCache: Record<
          string,
          {
            tree: { folders: Record<string, FolderMetadata>; notes: Record<string, Note> }
            ui: {
              expandedFolders: string[]
              selectedNoteId: string | null
              selectedNoteFolderId: string | null
            }
            metadata: { lastSaved: string; version: number }
          }
        >
        activeSpaceId: string
      }>
    ) => {
      const { spacesCache, activeSpaceId } = action.payload

      // Hydrate tutti gli spazi dalla cache
      Object.entries(spacesCache).forEach(([spaceId, spaceData]) => {
        state.spaces[spaceId] = {
          folders: spaceData.tree.folders,
          notes: spaceData.tree.notes,
          rootFolderId: 'root',
          expandedFolders: spaceData.ui.expandedFolders,
          selectedNoteId: spaceData.ui.selectedNoteId,
          selectedNoteFolderId: spaceData.ui.selectedNoteFolderId,
          isCacheHydrated: true,
          isFullyHydrated: false
        }
      })

      // Imposta active space
      state.activeSpaceId = activeSpaceId

      // Backward compatibility
      state.isHydrated = true
    },

    // Switch active space
    switchActiveSpace: (state, action: PayloadAction<string>) => {
      const newSpaceId = action.payload

      // Update active space reference
      state.activeSpaceId = newSpaceId

      // Initialize space state if not exists
      if (!state.spaces[newSpaceId]) {
        state.spaces[newSpaceId] = createEmptySpaceState()
      }
    },

    // Delete space state
    deleteSpaceState: (state, action: PayloadAction<string>) => {
      const spaceId = action.payload

      // Remove space from Redux
      delete state.spaces[spaceId]

      // If it was active, clear active reference
      if (state.activeSpaceId === spaceId) {
        state.activeSpaceId = null
      }
    },

    // UI Actions (modificano lo spazio attivo)
    toggleFolder: (state, action: PayloadAction<string>) => {
      if (!state.activeSpaceId) return
      const activeSpace = state.spaces[state.activeSpaceId]
      if (!activeSpace) return

      const folderId = action.payload
      const index = activeSpace.expandedFolders.indexOf(folderId)
      if (index > -1) {
        activeSpace.expandedFolders.splice(index, 1)
      } else {
        activeSpace.expandedFolders.push(folderId)
      }
    },

    expandFolder: (state, action: PayloadAction<string>) => {
      if (!state.activeSpaceId) return
      const activeSpace = state.spaces[state.activeSpaceId]
      if (!activeSpace) return

      const folderId = action.payload
      if (!activeSpace.expandedFolders.includes(folderId)) {
        activeSpace.expandedFolders.push(folderId)
      }
    },

    collapseFolder: (state, action: PayloadAction<string>) => {
      if (!state.activeSpaceId) return
      const activeSpace = state.spaces[state.activeSpaceId]
      if (!activeSpace) return

      const folderId = action.payload
      const index = activeSpace.expandedFolders.indexOf(folderId)
      if (index > -1) {
        activeSpace.expandedFolders.splice(index, 1)
      }
    },

    selectNote: (state, action: PayloadAction<{ noteId: string; folderId: string }>) => {
      if (!state.activeSpaceId) return
      const activeSpace = state.spaces[state.activeSpaceId]
      if (!activeSpace) return

      activeSpace.selectedNoteId = action.payload.noteId
      activeSpace.selectedNoteFolderId = action.payload.folderId
    },

    clearSelection: (state) => {
      if (!state.activeSpaceId) return
      const activeSpace = state.spaces[state.activeSpaceId]
      if (!activeSpace) return

      activeSpace.selectedNoteId = null
      activeSpace.selectedNoteFolderId = null
    }
  },

  extraReducers: (builder) => {
    // LOAD TREE
    builder
      .addCase(loadTree.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(loadTree.fulfilled, (state, action) => {
        state.loading = false

        const { spaceId, folders, notes } = action.payload

        // Initialize space if not exists
        if (!state.spaces[spaceId]) {
          state.spaces[spaceId] = createEmptySpaceState()
        }

        const space = state.spaces[spaceId]

        // Sovrascrivi con dati fresh dal filesystem
        space.folders = folders
        space.notes = notes

        // VALIDAZIONE UI STATE

        // 1. Valida selectedNoteId: se non esiste più, clear selection
        if (space.selectedNoteId && !notes[space.selectedNoteId]) {
          space.selectedNoteId = null
          space.selectedNoteFolderId = null
        }

        // 2. Valida expandedFolders: rimuovi ID che non esistono più
        space.expandedFolders = space.expandedFolders.filter((folderId) => folders[folderId])

        // 3. Assicurati che 'root' sia sempre espanso
        if (!space.expandedFolders.includes('root')) {
          space.expandedFolders.push('root')
        }

        // Set fully hydrated flag
        space.isFullyHydrated = true
        state.isHydrated = true // backward compatibility
      })
      .addCase(loadTree.rejected, (state, action) => {
        state.loading = false
        state.error = action.error.message || 'Errore nel caricamento del tree'
      })

    // CREATE NOTE
    builder
      .addCase(createNote.pending, (state, action) => {
        state.loadingOperations[`createNote-${action.meta.arg.folderId}`] = true
      })
      .addCase(createNote.fulfilled, (state, action) => {
        const { spaceId, note, folderId } = action.payload

        if (!state.spaces[spaceId]) return
        const space = state.spaces[spaceId]

        // Aggiungi nota allo state
        space.notes[note.id] = note

        // Aggiungi ID nota alla cartella parent
        if (space.folders[folderId]) {
          space.folders[folderId].noteIds.push(note.id)
        }

        // Auto-espandi parent folder
        if (!space.expandedFolders.includes(folderId)) {
          space.expandedFolders.push(folderId)
        }

        // Auto-seleziona nota
        space.selectedNoteId = note.id
        space.selectedNoteFolderId = folderId

        delete state.loadingOperations[`createNote-${folderId}`]
      })
      .addCase(createNote.rejected, (state, action) => {
        state.error = action.error.message || 'Errore nella creazione della nota'
        delete state.loadingOperations[`createNote-${action.meta.arg.folderId}`]
      })

    // UPDATE NOTE
    builder.addCase(updateNote.fulfilled, (state, action) => {
      const { spaceId, note } = action.payload

      if (!state.spaces[spaceId]) return
      const space = state.spaces[spaceId]

      space.notes[note.id] = note
    })

    // DELETE NOTE
    builder.addCase(deleteNote.fulfilled, (state, action) => {
      const { spaceId, noteId, folderId } = action.payload

      if (!state.spaces[spaceId]) return
      const space = state.spaces[spaceId]

      // Rimuovi nota dallo state
      delete space.notes[noteId]

      // Rimuovi ID nota dalla cartella parent
      if (space.folders[folderId]) {
        space.folders[folderId].noteIds = space.folders[folderId].noteIds.filter(
          (id) => id !== noteId
        )
      }

      // Deseleziona se era selezionata
      if (space.selectedNoteId === noteId) {
        space.selectedNoteId = null
        space.selectedNoteFolderId = null
      }
    })

    // CREATE FOLDER
    builder.addCase(createFolder.fulfilled, (state, action) => {
      const { spaceId, folder, parentId } = action.payload

      if (!state.spaces[spaceId]) return
      const space = state.spaces[spaceId]

      // Aggiungi cartella allo state
      space.folders[folder.id] = folder

      // Aggiungi ID cartella al parent
      if (space.folders[parentId]) {
        space.folders[parentId].children.push(folder.id)
      }

      // Auto-espandi parent
      if (!space.expandedFolders.includes(parentId)) {
        space.expandedFolders.push(parentId)
      }
    })

    // UPDATE FOLDER
    builder.addCase(updateFolder.fulfilled, (state, action) => {
      const { spaceId, folder } = action.payload

      if (!state.spaces[spaceId]) return
      const space = state.spaces[spaceId]

      space.folders[folder.id] = folder
    })

    // DELETE FOLDER (ricorsivo)
    builder.addCase(deleteFolder.fulfilled, (state, action) => {
      const { spaceId, folderId } = action.payload

      if (!state.spaces[spaceId]) return
      const space = state.spaces[spaceId]

      // Funzione ricorsiva per rimuovere cartella e tutti i suoi figli
      const removeFolderRecursive = (id: string): void => {
        const folder = space.folders[id]
        if (!folder) return

        // Rimuovi tutte le note nella cartella
        folder.noteIds.forEach((noteId) => {
          delete space.notes[noteId]
        })

        // Rimuovi ricorsivamente le sotto-cartelle
        folder.children.forEach((childId) => {
          removeFolderRecursive(childId)
        })

        // Rimuovi la cartella stessa
        delete space.folders[id]

        // Rimuovi da expandedFolders
        space.expandedFolders = space.expandedFolders.filter((f) => f !== id)
      }

      removeFolderRecursive(folderId)

      // Rimuovi dal parent
      const parentFolder = Object.values(space.folders).find((f) => f.children.includes(folderId))
      if (parentFolder) {
        parentFolder.children = parentFolder.children.filter((id) => id !== folderId)
      }

      // Deseleziona se la nota selezionata era in questa cartella
      if (space.selectedNoteFolderId === folderId) {
        space.selectedNoteId = null
        space.selectedNoteFolderId = null
      }
    })
  }
})

export const {
  hydrateUIState, // DEPRECATED
  hydrateFromCache, // DEPRECATED
  hydrateAllSpacesFromCache, // NEW
  switchActiveSpace, // NEW
  deleteSpaceState, // NEW
  toggleFolder,
  expandFolder,
  collapseFolder,
  selectNote,
  clearSelection
} = notesTreeSlice.actions

export default notesTreeSlice.reducer

// ============================================================================
// SELECTORS
// ============================================================================

// Helper: Selector per accedere allo spazio attivo
export const selectActiveSpaceState = (state: {
  notesTree: NotesTreeState
}): SpaceTreeState | undefined => {
  const { activeSpaceId, spaces } = state.notesTree
  if (!activeSpaceId) return undefined
  return spaces[activeSpaceId]
}

// Helper: Selector per accedere a uno spazio specifico
export const selectSpaceState =
  (spaceId: string) =>
  (state: { notesTree: NotesTreeState }): SpaceTreeState | undefined =>
    state.notesTree.spaces[spaceId]

// Selector per active space ID
export const selectActiveSpaceId = (state: { notesTree: NotesTreeState }): string | null =>
  state.notesTree.activeSpaceId

// Root folder dello spazio attivo
export const selectRootFolder = (state: {
  notesTree: NotesTreeState
}): FolderMetadata | undefined => {
  const activeSpace = selectActiveSpaceState(state)
  if (!activeSpace) return undefined
  return activeSpace.folders['root']
}

// Folder specifico dello spazio attivo
export const selectFolder =
  (folderId: string) =>
  (state: { notesTree: NotesTreeState }): FolderMetadata | undefined => {
    const activeSpace = selectActiveSpaceState(state)
    if (!activeSpace) return undefined
    return activeSpace.folders[folderId]
  }

// Nota specifica dello spazio attivo
export const selectNoteById =
  (noteId: string) =>
  (state: { notesTree: NotesTreeState }): Note | undefined => {
    const activeSpace = selectActiveSpaceState(state)
    if (!activeSpace) return undefined
    return activeSpace.notes[noteId]
  }

// Note in una cartella dello spazio attivo
export const selectNotesInFolder =
  (folderId: string) =>
  (state: { notesTree: NotesTreeState }): Note[] => {
    const activeSpace = selectActiveSpaceState(state)
    if (!activeSpace) return []

    const folder = activeSpace.folders[folderId]
    if (!folder) return []

    return folder.noteIds.map((id) => activeSpace.notes[id]).filter(Boolean)
  }

// Cartelle espanse dello spazio attivo
export const selectExpandedFolders = (state: { notesTree: NotesTreeState }): string[] => {
  const activeSpace = selectActiveSpaceState(state)
  if (!activeSpace) return []
  return activeSpace.expandedFolders
}

// Nota selezionata dello spazio attivo
export const selectSelectedNote = (state: {
  notesTree: NotesTreeState
}): {
  noteId: string | null
  folderId: string | null
  note: Note | null
} => {
  const activeSpace = selectActiveSpaceState(state)
  if (!activeSpace) {
    return { noteId: null, folderId: null, note: null }
  }

  return {
    noteId: activeSpace.selectedNoteId,
    folderId: activeSpace.selectedNoteFolderId,
    note: activeSpace.selectedNoteId ? activeSpace.notes[activeSpace.selectedNoteId] || null : null
  }
}

// Loading state (globale)
export const selectIsLoading = (state: { notesTree: NotesTreeState }): boolean =>
  state.notesTree.loading

// Error state (globale)
export const selectError = (state: { notesTree: NotesTreeState }): string | null =>
  state.notesTree.error

// Fully hydrated flag dello spazio attivo
export const selectIsFullyHydrated = (state: { notesTree: NotesTreeState }): boolean => {
  const activeSpace = selectActiveSpaceState(state)
  return activeSpace?.isFullyHydrated ?? false
}

// Selector per ottenere il tree gerarchico completo (per rendering sidebar)
export interface FolderTreeNode {
  folder: FolderMetadata
  notes: Note[]
  children: FolderTreeNode[]
}

export const selectFolderTreeRecursive =
  (folderId: string) =>
  (state: { notesTree: NotesTreeState }): FolderTreeNode | null => {
    const activeSpace = selectActiveSpaceState(state)
    if (!activeSpace) return null

    const folder = activeSpace.folders[folderId]
    if (!folder) return null

    return {
      folder,
      notes: folder.noteIds.map((id) => activeSpace.notes[id]).filter(Boolean),
      children: folder.children
        .map((childId) => selectFolderTreeRecursive(childId)(state))
        .filter((node): node is FolderTreeNode => node !== null)
    }
  }
