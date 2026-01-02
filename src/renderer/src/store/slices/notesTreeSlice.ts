import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit'
import type { Note, FolderMetadata } from '@preload/types'
import type { SerializedEditorState } from 'lexical'

// ============================================================================
// STATE INTERFACE
// ============================================================================

export interface NotesTreeState {
  // DATI (normalizzati)
  folders: Record<string, FolderMetadata> // { [folderId]: FolderMetadata }
  notes: Record<string, Note> // { [noteId]: Note }
  rootFolderId: string // 'root'

  // UI STATE
  expandedFolders: string[] // Folder IDs espansi
  selectedNoteId: string | null // Nota selezionata
  selectedNoteFolderId: string | null // Folder contenente la nota selezionata

  // LOADING & ERROR STATE
  loading: boolean // Loading generale
  loadingOperations: Record<string, boolean> // { 'createNote-folderId': true }
  error: string | null

  // PERSISTENCE
  isHydrated: boolean // Se lo stato è stato caricato da electron-store
}

const initialState: NotesTreeState = {
  folders: {},
  notes: {},
  rootFolderId: 'root',
  expandedFolders: ['root'],
  selectedNoteId: null,
  selectedNoteFolderId: null,
  loading: false,
  loadingOperations: {},
  error: null,
  isHydrated: false
}

// ============================================================================
// ASYNC THUNKS (chiamate IPC)
// ============================================================================

// Carica l'intero tree all'avvio
export const loadTree = createAsyncThunk('notesTree/loadTree', async () => {
  // Ottieni spaceId da electron-store
  const spaceId = await window.config.get('activeSpaceId')
  if (!spaceId) {
    throw new Error('No active space')
  }

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

  return loadFolderRecursive('root')
})

// Crea nota
export const createNote = createAsyncThunk(
  'notesTree/createNote',
  async (payload: { folderId: string; title: string; content: SerializedEditorState }) => {
    const spaceId = await window.config.get('activeSpaceId')
    if (!spaceId) throw new Error('No active space')

    const note = await window.fileSystem.createNote(
      spaceId,
      payload.folderId,
      payload.content,
      payload.title
    )
    return { note, folderId: payload.folderId }
  }
)

// Aggiorna nota
export const updateNote = createAsyncThunk(
  'notesTree/updateNote',
  async (payload: { folderId: string; noteId: string; updates: Partial<Note> }) => {
    const spaceId = await window.config.get('activeSpaceId')
    if (!spaceId) throw new Error('No active space')

    const note = await window.fileSystem.updateNote(
      spaceId,
      payload.folderId,
      payload.noteId,
      payload.updates
    )
    return note
  }
)

// Elimina nota
export const deleteNote = createAsyncThunk(
  'notesTree/deleteNote',
  async (payload: { folderId: string; noteId: string }) => {
    const spaceId = await window.config.get('activeSpaceId')
    if (!spaceId) throw new Error('No active space')

    await window.fileSystem.deleteNote(spaceId, payload.folderId, payload.noteId)
    return { noteId: payload.noteId, folderId: payload.folderId }
  }
)

// Crea cartella
export const createFolder = createAsyncThunk(
  'notesTree/createFolder',
  async (payload: { name: string; parentId: string }) => {
    const spaceId = await window.config.get('activeSpaceId')
    if (!spaceId) throw new Error('No active space')

    const folder = await window.fileSystem.createFolder(spaceId, payload.name, payload.parentId)
    return { folder, parentId: payload.parentId }
  }
)

// Aggiorna cartella
export const updateFolder = createAsyncThunk(
  'notesTree/updateFolder',
  async (payload: { folderId: string; updates: Partial<FolderMetadata> }) => {
    const spaceId = await window.config.get('activeSpaceId')
    if (!spaceId) throw new Error('No active space')

    const folder = await window.fileSystem.updateFolderMetadata(
      spaceId,
      payload.folderId,
      payload.updates
    )
    return folder
  }
)

// Elimina cartella (ricorsivo)
export const deleteFolder = createAsyncThunk(
  'notesTree/deleteFolder',
  async (payload: { folderId: string }) => {
    const spaceId = await window.config.get('activeSpaceId')
    if (!spaceId) throw new Error('No active space')

    await window.fileSystem.deleteFolder(spaceId, payload.folderId)
    return { folderId: payload.folderId }
  }
)

// ============================================================================
// SLICE
// ============================================================================

const notesTreeSlice = createSlice({
  name: 'notesTree',
  initialState,
  reducers: {
    // Hydrate UI state da electron-store all'avvio (NON i dati, solo UI)
    hydrateUIState: (
      state,
      action: PayloadAction<{
        expandedFolders: string[]
        selectedNoteId: string | null
        selectedNoteFolderId: string | null
      }>
    ) => {
      state.expandedFolders = action.payload.expandedFolders
      state.selectedNoteId = action.payload.selectedNoteId
      state.selectedNoteFolderId = action.payload.selectedNoteFolderId
      state.isHydrated = true
    },

    // UI Actions
    toggleFolder: (state, action: PayloadAction<string>) => {
      const index = state.expandedFolders.indexOf(action.payload)
      if (index > -1) {
        state.expandedFolders.splice(index, 1)
      } else {
        state.expandedFolders.push(action.payload)
      }
    },

    expandFolder: (state, action: PayloadAction<string>) => {
      if (!state.expandedFolders.includes(action.payload)) {
        state.expandedFolders.push(action.payload)
      }
    },

    collapseFolder: (state, action: PayloadAction<string>) => {
      const index = state.expandedFolders.indexOf(action.payload)
      if (index > -1) {
        state.expandedFolders.splice(index, 1)
      }
    },

    selectNote: (state, action: PayloadAction<{ noteId: string; folderId: string }>) => {
      state.selectedNoteId = action.payload.noteId
      state.selectedNoteFolderId = action.payload.folderId
    },

    clearSelection: (state) => {
      state.selectedNoteId = null
      state.selectedNoteFolderId = null
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
        state.folders = action.payload.folders
        state.notes = action.payload.notes
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
        const { note, folderId } = action.payload

        // Aggiungi nota allo state
        state.notes[note.id] = note

        // Aggiungi ID nota alla cartella parent
        if (state.folders[folderId]) {
          state.folders[folderId].noteIds.push(note.id)
        }

        // Auto-espandi parent folder
        if (!state.expandedFolders.includes(folderId)) {
          state.expandedFolders.push(folderId)
        }

        // Auto-seleziona nota
        state.selectedNoteId = note.id
        state.selectedNoteFolderId = folderId

        delete state.loadingOperations[`createNote-${folderId}`]
      })
      .addCase(createNote.rejected, (state, action) => {
        state.error = action.error.message || 'Errore nella creazione della nota'
        delete state.loadingOperations[`createNote-${action.meta.arg.folderId}`]
      })

    // UPDATE NOTE
    builder.addCase(updateNote.fulfilled, (state, action) => {
      state.notes[action.payload.id] = action.payload
    })

    // DELETE NOTE
    builder.addCase(deleteNote.fulfilled, (state, action) => {
      const { noteId, folderId } = action.payload

      // Rimuovi nota dallo state
      delete state.notes[noteId]

      // Rimuovi ID nota dalla cartella parent
      if (state.folders[folderId]) {
        state.folders[folderId].noteIds = state.folders[folderId].noteIds.filter(
          (id) => id !== noteId
        )
      }

      // Deseleziona se era selezionata
      if (state.selectedNoteId === noteId) {
        state.selectedNoteId = null
        state.selectedNoteFolderId = null
      }
    })

    // CREATE FOLDER
    builder.addCase(createFolder.fulfilled, (state, action) => {
      const { folder, parentId } = action.payload

      // Aggiungi cartella allo state
      state.folders[folder.id] = folder

      // Aggiungi ID cartella al parent
      if (state.folders[parentId]) {
        state.folders[parentId].children.push(folder.id)
      }

      // Auto-espandi parent
      if (!state.expandedFolders.includes(parentId)) {
        state.expandedFolders.push(parentId)
      }
    })

    // UPDATE FOLDER
    builder.addCase(updateFolder.fulfilled, (state, action) => {
      state.folders[action.payload.id] = action.payload
    })

    // DELETE FOLDER (ricorsivo)
    builder.addCase(deleteFolder.fulfilled, (state, action) => {
      const { folderId } = action.payload

      // Funzione ricorsiva per rimuovere cartella e tutti i suoi figli
      const removeFolderRecursive = (id: string): void => {
        const folder = state.folders[id]
        if (!folder) return

        // Rimuovi tutte le note nella cartella
        folder.noteIds.forEach((noteId) => {
          delete state.notes[noteId]
        })

        // Rimuovi ricorsivamente le sotto-cartelle
        folder.children.forEach((childId) => {
          removeFolderRecursive(childId)
        })

        // Rimuovi la cartella stessa
        delete state.folders[id]

        // Rimuovi da expandedFolders
        state.expandedFolders = state.expandedFolders.filter((f) => f !== id)
      }

      removeFolderRecursive(folderId)

      // Rimuovi dal parent
      const parentFolder = Object.values(state.folders).find((f) => f.children.includes(folderId))
      if (parentFolder) {
        parentFolder.children = parentFolder.children.filter((id) => id !== folderId)
      }

      // Deseleziona se la nota selezionata era in questa cartella
      if (state.selectedNoteFolderId === folderId) {
        state.selectedNoteId = null
        state.selectedNoteFolderId = null
      }
    })
  }
})

export const {
  hydrateUIState,
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

export const selectRootFolder = (state: {
  notesTree: NotesTreeState
}): FolderMetadata | undefined => state.notesTree.folders['root']

export const selectFolder =
  (folderId: string) =>
  (state: { notesTree: NotesTreeState }): FolderMetadata | undefined =>
    state.notesTree.folders[folderId]

export const selectNoteById =
  (noteId: string) =>
  (state: { notesTree: NotesTreeState }): Note | undefined =>
    state.notesTree.notes[noteId]

export const selectNotesInFolder =
  (folderId: string) =>
  (state: { notesTree: NotesTreeState }): Note[] => {
    const folder = state.notesTree.folders[folderId]
    if (!folder) return []
    return folder.noteIds.map((id) => state.notesTree.notes[id]).filter(Boolean)
  }

export const selectExpandedFolders = (state: { notesTree: NotesTreeState }): string[] =>
  state.notesTree.expandedFolders

export const selectSelectedNote = (state: {
  notesTree: NotesTreeState
}): {
  noteId: string | null
  folderId: string | null
  note: Note | null
} => ({
  noteId: state.notesTree.selectedNoteId,
  folderId: state.notesTree.selectedNoteFolderId,
  note: state.notesTree.selectedNoteId
    ? state.notesTree.notes[state.notesTree.selectedNoteId] || null
    : null
})

export const selectIsLoading = (state: { notesTree: NotesTreeState }): boolean =>
  state.notesTree.loading

export const selectError = (state: { notesTree: NotesTreeState }): string | null =>
  state.notesTree.error

// Selector per ottenere il tree gerarchico completo (per rendering sidebar)
export interface FolderTreeNode {
  folder: FolderMetadata
  notes: Note[]
  children: FolderTreeNode[]
}

export const selectFolderTreeRecursive =
  (folderId: string) =>
  (state: { notesTree: NotesTreeState }): FolderTreeNode | null => {
    const folder = state.notesTree.folders[folderId]
    if (!folder) return null

    return {
      folder,
      notes: folder.noteIds.map((id) => state.notesTree.notes[id]).filter(Boolean),
      children: folder.children
        .map((childId) => selectFolderTreeRecursive(childId)(state))
        .filter((node): node is FolderTreeNode => node !== null)
    }
  }
