// Type definitions for file system entities
export interface Note {
  id: string
  folderId: string
  content: string // Markdown content
  createdAt: string
  updatedAt: string
  title: string
}

export interface FolderMetadata {
  id: string
  name: string
  parentId: string | null
  children: string[]
  createdAt: string
  updatedAt: string
  noteIds: string[]
}

export interface Asset {
  id: string
  originalName: string
  type: 'image' | 'pdf' | 'attachment'
  path: string
  size: number
  createdAt: string
}

// Cross-space move result types
export interface MoveFolderToSpaceResult {
  folders: Record<string, FolderMetadata>
  notes: Record<string, Note>
  topFolderId: string
}

// Space type
export interface Space {
  id: string
  name: string
  icon: string
  createdAt: string
  updatedAt: string
  order: number
}

// Import types re-exported for renderer consumption
export type {
  ImportSource,
  ImportOptions,
  ImportScanResult,
  ImportResult,
  ImportProgressEvent
} from '../main/import/types'

// App configuration type
export interface AppConfig {
  theme: 'light' | 'dark' | 'system'
  editorFontSize: number
  autoSave: boolean
  autoSaveInterval: number
  autoIndexNotes: boolean
  lastOpenedFolderId: string | null
  windowBounds: {
    width: number
    height: number
    x?: number
    y?: number
  }
  recentNotes: string[]
  activeSpaceId: string | null
  spacesInitialized: boolean
  onboardingCompleted: boolean
  // AI Chat Panel state
  aiChatPanelOpen: boolean
  aiChatPanelSize: number
  // Redux persistence (new multi-space structure)
  reduxSpacesCaches?: Record<
    string,
    {
      tree: {
        folders: Record<string, unknown>
        notes: Record<string, unknown>
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
  // LEGACY Redux persistence (mantenute per migrazione)
  reduxUIState?: {
    expandedFolders: string[]
    selectedNoteId: string | null
    selectedNoteFolderId: string | null
  }
  reduxTreeCache?: {
    folders: Record<string, unknown>
    notes: Record<string, unknown>
  }
}
