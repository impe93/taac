import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit'
import type { Note, FolderMetadata, OrderedItem } from '@preload/types'
import { reconcileItems } from '@renderer/lib/treeOrder'

// ----------------------------------------------------------------------------
// Helpers per mantenere `folder.items` (ordine interlacciato) negli optimistic
// update. Speculari al backend; il rendering usa comunque reconcileItems.
// ----------------------------------------------------------------------------

function insertOrderedItem(folder: FolderMetadata, item: OrderedItem, index?: number): void {
  const items = (folder.items ?? []).filter((existing) => existing.id !== item.id)
  if (typeof index === 'number') {
    items.splice(Math.max(0, Math.min(index, items.length)), 0, item)
  } else {
    items.push(item)
  }
  folder.items = items
}

function removeOrderedItem(folder: FolderMetadata, id: string): void {
  folder.items = (folder.items ?? []).filter((existing) => existing.id !== id)
}

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
  selectedNoteId: string | null // Nota selezionata (= scheda con focus)
  selectedNoteFolderId: string | null // Folder contenente la nota selezionata
  openTabs: string[] // Note aperte in schede (ID nota, ordinati)

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
    openTabs: [],
    isCacheHydrated: false,
    isFullyHydrated: false
  }
}

// Helper: sceglie la scheda su cui spostare il focus dopo aver rimosso `closedId`.
// Preferisce la scheda che occupava l'indice precedente, poi la successiva.
function pickNeighborTab(previousTabs: string[], closedId: string): string | null {
  const index = previousTabs.indexOf(closedId)
  if (index === -1) return null
  const remaining = previousTabs.filter((id) => id !== closedId)
  if (remaining.length === 0) return null
  const neighborIndex = Math.max(0, Math.min(index - 1, remaining.length - 1))
  return remaining[neighborIndex]
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
    content: string
    type?: 'note' | 'meeting'
  }) => {
    const { spaceId, folderId, title, content, type } = payload

    const note = await window.fileSystem.createNote(spaceId, folderId, content, title, type)
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

// Sposta nota tra cartelle (targetIndex opzionale = drop posizionale)
export const moveNote = createAsyncThunk(
  'notesTree/moveNote',
  async (payload: {
    spaceId: string
    noteId: string
    sourceFolderId: string
    targetFolderId: string
    targetIndex?: number
  }) => {
    const { spaceId, noteId, sourceFolderId, targetFolderId, targetIndex } = payload

    const updatedNote = await window.fileSystem.moveNote(
      spaceId,
      noteId,
      sourceFolderId,
      targetFolderId,
      targetIndex
    )

    return { spaceId, noteId, sourceFolderId, targetFolderId, updatedNote }
  }
)

// Sposta cartella (targetIndex opzionale = drop posizionale)
export const moveFolder = createAsyncThunk(
  'notesTree/moveFolder',
  async (payload: {
    spaceId: string
    folderId: string
    currentParentId: string | null
    targetParentId: string
    targetIndex?: number
  }) => {
    const { spaceId, folderId, currentParentId, targetParentId, targetIndex } = payload

    const updatedFolder = await window.fileSystem.moveFolder(
      spaceId,
      folderId,
      targetParentId,
      targetIndex
    )

    return { spaceId, folderId, currentParentId, targetParentId, updatedFolder }
  }
)

// Riordina gli elementi (note + sottocartelle) dentro una cartella.
// `previousItems` serve solo al rollback in caso di errore IPC.
export const reorderItems = createAsyncThunk(
  'notesTree/reorderItems',
  async (payload: {
    spaceId: string
    parentFolderId: string
    orderedItems: OrderedItem[]
    previousItems: OrderedItem[]
  }) => {
    const { spaceId, parentFolderId, orderedItems } = payload

    const updatedFolder = await window.fileSystem.reorderItems(
      spaceId,
      parentFolderId,
      orderedItems
    )

    return { spaceId, parentFolderId, updatedFolder }
  }
)

// Cross-space move: Sposta nota in un altro spazio
export const moveNoteToSpace = createAsyncThunk(
  'notesTree/moveNoteToSpace',
  async (payload: {
    sourceSpaceId: string
    targetSpaceId: string
    noteId: string
    sourceFolderId: string
  }) => {
    const { sourceSpaceId, targetSpaceId, noteId, sourceFolderId } = payload

    const targetNote = await window.fileSystem.moveNoteToSpace(
      sourceSpaceId,
      targetSpaceId,
      noteId,
      sourceFolderId
    )

    return { sourceSpaceId, targetSpaceId, noteId, sourceFolderId, targetNote }
  }
)

// Cross-space move: Sposta cartella in un altro spazio
export const moveFolderToSpace = createAsyncThunk(
  'notesTree/moveFolderToSpace',
  async (payload: { sourceSpaceId: string; targetSpaceId: string; folderId: string }) => {
    const { sourceSpaceId, targetSpaceId, folderId } = payload

    const result = await window.fileSystem.moveFolderToSpace(sourceSpaceId, targetSpaceId, folderId)

    return {
      sourceSpaceId,
      targetSpaceId,
      folderId,
      createdFolders: result.folders,
      createdNotes: result.notes,
      topFolderId: result.topFolderId
    }
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
              openTabs?: string[]
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
          // Backfill per cache vecchie: se manca openTabs, apri la nota selezionata (se c'è)
          openTabs:
            spaceData.ui.openTabs ??
            (spaceData.ui.selectedNoteId ? [spaceData.ui.selectedNoteId] : []),
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
    },

    // TABS: apre una nota in scheda (o ne porta il focus se già aperta)
    openTab: (state, action: PayloadAction<{ noteId: string; folderId: string }>) => {
      if (!state.activeSpaceId) return
      const activeSpace = state.spaces[state.activeSpaceId]
      if (!activeSpace) return

      const { noteId, folderId } = action.payload
      if (!activeSpace.openTabs.includes(noteId)) {
        activeSpace.openTabs.push(noteId)
      }
      activeSpace.selectedNoteId = noteId
      activeSpace.selectedNoteFolderId = folderId
    },

    // TABS: chiude una scheda; se era la selezionata, sposta il focus al vicino
    closeTab: (state, action: PayloadAction<{ noteId: string }>) => {
      if (!state.activeSpaceId) return
      const activeSpace = state.spaces[state.activeSpaceId]
      if (!activeSpace) return

      const { noteId } = action.payload
      if (!activeSpace.openTabs.includes(noteId)) return

      const wasSelected = activeSpace.selectedNoteId === noteId
      const neighborId = wasSelected ? pickNeighborTab(activeSpace.openTabs, noteId) : null

      activeSpace.openTabs = activeSpace.openTabs.filter((id) => id !== noteId)

      if (wasSelected) {
        activeSpace.selectedNoteId = neighborId
        activeSpace.selectedNoteFolderId = neighborId
          ? (activeSpace.notes[neighborId]?.folderId ?? null)
          : null
      }
    },

    // TABS: riordina le schede (riordino puro, nessuna chiamata IPC)
    reorderTabs: (state, action: PayloadAction<{ orderedIds: string[] }>) => {
      if (!state.activeSpaceId) return
      const activeSpace = state.spaces[state.activeSpaceId]
      if (!activeSpace) return

      // Preserva solo gli ID realmente aperti, nell'ordine richiesto
      const current = new Set(activeSpace.openTabs)
      const reordered = action.payload.orderedIds.filter((id) => current.has(id))
      // Accoda eventuali schede mancanti dall'ordine ricevuto (safety)
      for (const id of activeSpace.openTabs) {
        if (!reordered.includes(id)) reordered.push(id)
      }
      activeSpace.openTabs = reordered
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

        // 1b. Valida openTabs: scarta schede di note non più esistenti sul filesystem
        space.openTabs = space.openTabs.filter((noteId) => notes[noteId])
        // Se il focus è caduto ma restano schede aperte, riparti dalla prima
        if (!space.selectedNoteId && space.openTabs.length > 0) {
          const firstTabId = space.openTabs[0]
          const firstNote = notes[firstTabId]
          space.selectedNoteId = firstTabId
          space.selectedNoteFolderId = firstNote?.folderId ?? null
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
        state.error = action.error.message || 'Failed to load tree'
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

        // Auto-seleziona nota e aprila in scheda
        space.selectedNoteId = note.id
        space.selectedNoteFolderId = folderId
        if (!space.openTabs.includes(note.id)) {
          space.openTabs.push(note.id)
        }

        delete state.loadingOperations[`createNote-${folderId}`]
      })
      .addCase(createNote.rejected, (state, action) => {
        state.error = action.error.message || 'Failed to create note'
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

      // Chiudi la scheda della nota eliminata, rifocalizzando il vicino se era attiva
      if (space.openTabs.includes(noteId)) {
        const wasSelected = space.selectedNoteId === noteId
        const neighborId = wasSelected ? pickNeighborTab(space.openTabs, noteId) : null
        space.openTabs = space.openTabs.filter((id) => id !== noteId)
        if (wasSelected) {
          space.selectedNoteId = neighborId
          space.selectedNoteFolderId = neighborId
            ? (space.notes[neighborId]?.folderId ?? null)
            : null
        }
      } else if (space.selectedNoteId === noteId) {
        // Deseleziona se era selezionata ma non aperta in scheda
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

      // Snapshot delle schede aperte prima della rimozione (per scegliere il vicino)
      const previousTabs = [...space.openTabs]
      const selectedBefore = space.selectedNoteId

      // Funzione ricorsiva per rimuovere cartella e tutti i suoi figli
      const removeFolderRecursive = (id: string): void => {
        const folder = space.folders[id]
        if (!folder) return

        // Rimuovi tutte le note nella cartella (anche dalle schede aperte)
        folder.noteIds.forEach((noteId) => {
          delete space.notes[noteId]
          space.openTabs = space.openTabs.filter((tabId) => tabId !== noteId)
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

      // Se la nota selezionata è stata eliminata, sposta il focus a una scheda vicina
      if (selectedBefore && !space.notes[selectedBefore]) {
        const neighborId = pickNeighborTab(previousTabs, selectedBefore)
        const stillOpen = neighborId && space.openTabs.includes(neighborId) ? neighborId : null
        const fallback = stillOpen ?? (space.openTabs.length > 0 ? space.openTabs[0] : null)
        space.selectedNoteId = fallback
        space.selectedNoteFolderId = fallback ? (space.notes[fallback]?.folderId ?? null) : null
      }
    })

    // MOVE NOTE - Optimistic update
    builder
      .addCase(moveNote.pending, (state, action) => {
        const { spaceId, noteId, sourceFolderId, targetFolderId } = action.meta.arg

        if (!state.spaces[spaceId]) return
        const space = state.spaces[spaceId]

        // OPTIMISTIC UPDATE
        const note = space.notes[noteId]
        if (!note) return

        // Update note's folderId
        note.folderId = targetFolderId

        // Remove from source folder
        if (space.folders[sourceFolderId]) {
          space.folders[sourceFolderId].noteIds = space.folders[sourceFolderId].noteIds.filter(
            (id) => id !== noteId
          )
          removeOrderedItem(space.folders[sourceFolderId], noteId)
        }

        // Add to target folder
        if (space.folders[targetFolderId]) {
          if (!space.folders[targetFolderId].noteIds.includes(noteId)) {
            space.folders[targetFolderId].noteIds.push(noteId)
          }
          // Posiziona nell'ordine interlacciato (in coda se targetIndex assente)
          insertOrderedItem(
            space.folders[targetFolderId],
            { type: 'note', id: noteId },
            action.meta.arg.targetIndex
          )
        }

        // Update selection if moved note is selected
        if (space.selectedNoteId === noteId) {
          space.selectedNoteFolderId = targetFolderId
        }
      })
      .addCase(moveNote.fulfilled, (state, action) => {
        const { spaceId, updatedNote } = action.payload

        if (!state.spaces[spaceId]) return
        const space = state.spaces[spaceId]

        // Update with confirmed data from backend
        space.notes[updatedNote.id] = updatedNote
      })
      .addCase(moveNote.rejected, (state, action) => {
        const { spaceId, noteId, sourceFolderId, targetFolderId } = action.meta.arg

        if (!state.spaces[spaceId]) return
        const space = state.spaces[spaceId]

        // ROLLBACK OPTIMISTIC UPDATE
        const note = space.notes[noteId]
        if (!note) return

        // Restore original folderId
        note.folderId = sourceFolderId

        // Remove from target folder
        if (space.folders[targetFolderId]) {
          space.folders[targetFolderId].noteIds = space.folders[targetFolderId].noteIds.filter(
            (id) => id !== noteId
          )
          removeOrderedItem(space.folders[targetFolderId], noteId)
        }

        // Re-add to source folder
        if (
          space.folders[sourceFolderId] &&
          !space.folders[sourceFolderId].noteIds.includes(noteId)
        ) {
          space.folders[sourceFolderId].noteIds.push(noteId)
          insertOrderedItem(space.folders[sourceFolderId], { type: 'note', id: noteId })
        }

        // Restore selection
        if (space.selectedNoteId === noteId) {
          space.selectedNoteFolderId = sourceFolderId
        }

        // Set error message
        state.error = action.error.message || 'Failed to move note'
      })

    // MOVE FOLDER - Optimistic update
    builder
      .addCase(moveFolder.pending, (state, action) => {
        const { spaceId, folderId, currentParentId, targetParentId } = action.meta.arg

        if (!state.spaces[spaceId]) return
        const space = state.spaces[spaceId]

        // OPTIMISTIC UPDATE
        const folder = space.folders[folderId]
        if (!folder) return

        // Update folder's parentId
        folder.parentId = targetParentId

        // Remove from current parent's children
        if (currentParentId && space.folders[currentParentId]) {
          space.folders[currentParentId].children = space.folders[currentParentId].children.filter(
            (id) => id !== folderId
          )
          removeOrderedItem(space.folders[currentParentId], folderId)
        }

        // Add to target parent's children
        if (space.folders[targetParentId]) {
          if (!space.folders[targetParentId].children.includes(folderId)) {
            space.folders[targetParentId].children.push(folderId)
          }
          // Posiziona nell'ordine interlacciato (in coda se targetIndex assente)
          insertOrderedItem(
            space.folders[targetParentId],
            { type: 'folder', id: folderId },
            action.meta.arg.targetIndex
          )
        }

        // Auto-expand target parent
        if (!space.expandedFolders.includes(targetParentId)) {
          space.expandedFolders.push(targetParentId)
        }
      })
      .addCase(moveFolder.fulfilled, (state, action) => {
        const { spaceId, updatedFolder } = action.payload

        if (!state.spaces[spaceId]) return
        const space = state.spaces[spaceId]

        // Update with confirmed data from backend
        space.folders[updatedFolder.id] = updatedFolder
      })
      .addCase(moveFolder.rejected, (state, action) => {
        const { spaceId, folderId, currentParentId, targetParentId } = action.meta.arg

        if (!state.spaces[spaceId]) return
        const space = state.spaces[spaceId]

        // ROLLBACK OPTIMISTIC UPDATE
        const folder = space.folders[folderId]
        if (!folder) return

        // Restore original parentId
        folder.parentId = currentParentId

        // Remove from target parent's children
        if (space.folders[targetParentId]) {
          space.folders[targetParentId].children = space.folders[targetParentId].children.filter(
            (id) => id !== folderId
          )
          removeOrderedItem(space.folders[targetParentId], folderId)
        }

        // Re-add to current parent's children
        if (
          currentParentId &&
          space.folders[currentParentId] &&
          !space.folders[currentParentId].children.includes(folderId)
        ) {
          space.folders[currentParentId].children.push(folderId)
          insertOrderedItem(space.folders[currentParentId], { type: 'folder', id: folderId })
        }

        // Set error message
        state.error = action.error.message || 'Failed to move folder'
      })

    // REORDER ITEMS - Optimistic update (riordino interlacciato in una cartella)
    builder
      .addCase(reorderItems.pending, (state, action) => {
        const { spaceId, parentFolderId, orderedItems } = action.meta.arg

        if (!state.spaces[spaceId]) return
        const folder = state.spaces[spaceId].folders[parentFolderId]
        if (!folder) return

        folder.items = orderedItems
      })
      .addCase(reorderItems.fulfilled, (state, action) => {
        const { spaceId, updatedFolder } = action.payload

        if (!state.spaces[spaceId]) return
        state.spaces[spaceId].folders[updatedFolder.id] = updatedFolder
      })
      .addCase(reorderItems.rejected, (state, action) => {
        const { spaceId, parentFolderId, previousItems } = action.meta.arg

        if (!state.spaces[spaceId]) return
        const folder = state.spaces[spaceId].folders[parentFolderId]
        if (folder) {
          // ROLLBACK all'ordine precedente
          folder.items = previousItems
        }

        state.error = action.error.message || 'Failed to reorder items'
      })

    // MOVE NOTE TO SPACE - Cross-space move
    builder
      .addCase(moveNoteToSpace.pending, (state, action) => {
        const { sourceSpaceId, noteId, sourceFolderId } = action.meta.arg

        // Optimistically remove from source space
        const sourceSpace = state.spaces[sourceSpaceId]
        if (!sourceSpace) return

        // Remove note from notes
        delete sourceSpace.notes[noteId]

        // Remove noteId from source folder
        if (sourceSpace.folders[sourceFolderId]) {
          sourceSpace.folders[sourceFolderId].noteIds = sourceSpace.folders[
            sourceFolderId
          ].noteIds.filter((id) => id !== noteId)
        }

        // Chiudi la scheda nello spazio sorgente, rifocalizzando il vicino
        if (sourceSpace.openTabs.includes(noteId)) {
          const wasSelected = sourceSpace.selectedNoteId === noteId
          const neighborId = wasSelected ? pickNeighborTab(sourceSpace.openTabs, noteId) : null
          sourceSpace.openTabs = sourceSpace.openTabs.filter((id) => id !== noteId)
          if (wasSelected) {
            sourceSpace.selectedNoteId = neighborId
            sourceSpace.selectedNoteFolderId = neighborId
              ? (sourceSpace.notes[neighborId]?.folderId ?? null)
              : null
          }
        } else if (sourceSpace.selectedNoteId === noteId) {
          sourceSpace.selectedNoteId = null
          sourceSpace.selectedNoteFolderId = null
        }
      })
      .addCase(moveNoteToSpace.fulfilled, (state, action) => {
        const { targetSpaceId, targetNote } = action.payload

        // Add to target space (if it exists in Redux state)
        const targetSpace = state.spaces[targetSpaceId]
        if (!targetSpace) return

        // Add note to target space
        targetSpace.notes[targetNote.id] = targetNote

        // Add noteId to root folder in target space
        if (targetSpace.folders['root']) {
          if (!targetSpace.folders['root'].noteIds.includes(targetNote.id)) {
            targetSpace.folders['root'].noteIds.push(targetNote.id)
          }
        }
      })
      .addCase(moveNoteToSpace.rejected, (state, action) => {
        // On failure, we need to reload the tree since the optimistic update
        // removed the note but the backend didn't complete the move
        state.error = action.error.message || 'Failed to move note to space'
        // Note: The caller should trigger a loadTree to restore state
      })

    // MOVE FOLDER TO SPACE - Cross-space move
    builder
      .addCase(moveFolderToSpace.pending, (state, action) => {
        const { sourceSpaceId, folderId } = action.meta.arg

        const sourceSpace = state.spaces[sourceSpaceId]
        if (!sourceSpace) return

        // Helper to collect all folder IDs and note IDs in subtree
        const collectSubtreeIds = (fId: string): { folderIds: string[]; noteIds: string[] } => {
          const folder = sourceSpace.folders[fId]
          if (!folder) return { folderIds: [], noteIds: [] }

          const folderIds: string[] = [fId]
          const noteIds: string[] = [...folder.noteIds]

          for (const childId of folder.children) {
            const childData = collectSubtreeIds(childId)
            folderIds.push(...childData.folderIds)
            noteIds.push(...childData.noteIds)
          }

          return { folderIds, noteIds }
        }

        const { folderIds, noteIds } = collectSubtreeIds(folderId)

        // Get parent of the folder being moved
        const folder = sourceSpace.folders[folderId]
        const parentId = folder?.parentId

        // Snapshot per scegliere il vicino se la scheda attiva viene spostata
        const previousTabs = [...sourceSpace.openTabs]
        const selectedBefore = sourceSpace.selectedNoteId

        // Remove all notes in subtree (anche dalle schede aperte)
        noteIds.forEach((noteId) => {
          delete sourceSpace.notes[noteId]
          sourceSpace.openTabs = sourceSpace.openTabs.filter((id) => id !== noteId)
        })

        // Se la nota attiva è stata spostata, sposta il focus a una scheda vicina
        if (selectedBefore && !sourceSpace.notes[selectedBefore]) {
          const neighborId = pickNeighborTab(previousTabs, selectedBefore)
          const stillOpen =
            neighborId && sourceSpace.openTabs.includes(neighborId) ? neighborId : null
          const fallback =
            stillOpen ?? (sourceSpace.openTabs.length > 0 ? sourceSpace.openTabs[0] : null)
          sourceSpace.selectedNoteId = fallback
          sourceSpace.selectedNoteFolderId = fallback
            ? (sourceSpace.notes[fallback]?.folderId ?? null)
            : null
        }

        // Remove all folders in subtree
        folderIds.forEach((fId) => {
          delete sourceSpace.folders[fId]
          // Remove from expandedFolders
          sourceSpace.expandedFolders = sourceSpace.expandedFolders.filter((id) => id !== fId)
        })

        // Remove from parent's children
        if (parentId && sourceSpace.folders[parentId]) {
          sourceSpace.folders[parentId].children = sourceSpace.folders[parentId].children.filter(
            (id) => id !== folderId
          )
        }
      })
      .addCase(moveFolderToSpace.fulfilled, (state, action) => {
        const { targetSpaceId, createdFolders, createdNotes, topFolderId } = action.payload

        // Add to target space (if it exists in Redux state)
        const targetSpace = state.spaces[targetSpaceId]
        if (!targetSpace) return

        // Add ALL created folders to target space
        Object.entries(createdFolders).forEach(([folderId, folder]) => {
          targetSpace.folders[folderId] = folder
        })

        // Add ALL created notes to target space
        Object.entries(createdNotes).forEach(([noteId, note]) => {
          targetSpace.notes[noteId] = note
        })

        // Update root's children in target space (add top-level folder)
        if (targetSpace.folders['root']) {
          if (!targetSpace.folders['root'].children.includes(topFolderId)) {
            targetSpace.folders['root'].children.push(topFolderId)
          }
        }

        // Auto-expand root in target space
        if (!targetSpace.expandedFolders.includes('root')) {
          targetSpace.expandedFolders.push('root')
        }
      })
      .addCase(moveFolderToSpace.rejected, (state, action) => {
        // On failure, we need to reload the tree since the optimistic update
        // removed the folder but the backend didn't complete the move
        state.error = action.error.message || 'Failed to move folder to space'
        // Note: The caller should trigger a loadTree to restore state
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
  clearSelection,
  openTab, // TABS
  closeTab, // TABS
  reorderTabs // TABS
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

// Ordine interlacciato (note + sottocartelle) di una cartella dello spazio attivo.
// Riconcilia `items` con `noteIds`/`children`: i nuovi id vengono accodati,
// quelli rimossi scartati, l'ordine personalizzato preservato.
export const selectOrderedItems =
  (folderId: string) =>
  (state: { notesTree: NotesTreeState }): OrderedItem[] => {
    const activeSpace = selectActiveSpaceState(state)
    if (!activeSpace) return []

    const folder = activeSpace.folders[folderId]
    if (!folder) return []

    return reconcileItems(folder)
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

// TABS: ID delle note aperte in scheda nello spazio attivo (ordinati)
export const selectOpenTabs = (state: { notesTree: NotesTreeState }): string[] => {
  const activeSpace = selectActiveSpaceState(state)
  if (!activeSpace) return []
  return activeSpace.openTabs
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
