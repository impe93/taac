import type { SerializedEditorState } from 'lexical'

// Type definitions for file system entities
export interface Note {
  id: string
  folderId: string
  content: SerializedEditorState
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

// Space type
export interface Space {
  id: string
  name: string
  icon: string
  createdAt: string
  updatedAt: string
  order: number
}

// App configuration type
export interface AppConfig {
  theme: 'light' | 'dark' | 'system'
  editorFontSize: number
  autoSave: boolean
  autoSaveInterval: number
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
}
