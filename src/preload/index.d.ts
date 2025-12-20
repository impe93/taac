import { ElectronAPI } from '@electron-toolkit/preload'
import type { SerializedEditorState } from 'lexical'
import type { Note, FolderMetadata, Asset, AppConfig } from './types'

// Re-export types from types.ts for convenience
export type { Note, FolderMetadata, Asset, AppConfig }

// File System API interface
export interface FileSystemAPI {
  // Note operations
  createNote: (folderId: string, content: SerializedEditorState, title: string) => Promise<Note>
  readNote: (folderId: string, noteId: string) => Promise<Note>
  updateNote: (folderId: string, noteId: string, updates: Partial<Note>) => Promise<Note>
  deleteNote: (folderId: string, noteId: string) => Promise<void>
  listNotes: (folderId: string) => Promise<Note[]>

  // Folder operations
  createFolder: (name: string, parentId?: string) => Promise<FolderMetadata>
  readFolderMetadata: (folderId: string) => Promise<FolderMetadata>
  updateFolderMetadata: (
    folderId: string,
    updates: Partial<FolderMetadata>
  ) => Promise<FolderMetadata>
  deleteFolder: (folderId: string) => Promise<void>
  getFolderTree: () => Promise<FolderMetadata>

  // Asset operations
  saveAsset: (
    originalName: string,
    buffer: Uint8Array,
    type: 'image' | 'pdf' | 'attachment'
  ) => Promise<Asset>
  readAsset: (assetId: string, type: 'image' | 'pdf' | 'attachment') => Promise<Buffer>
  deleteAsset: (assetId: string, type: 'image' | 'pdf' | 'attachment') => Promise<void>

  // Database
  getDatabasePath: () => Promise<string>
}

// Config API interface
export interface ConfigAPI {
  get: <K extends keyof AppConfig>(key: K) => Promise<AppConfig[K]>
  set: <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => Promise<void>
  getAll: () => Promise<AppConfig>
  reset: () => Promise<void>
  onChange: <K extends keyof AppConfig>(
    key: K,
    callback: (newValue: AppConfig[K], oldValue: AppConfig[K]) => void
  ) => void
}

// Global window interface
declare global {
  interface Window {
    electron: ElectronAPI
    fileSystem: FileSystemAPI
    config: ConfigAPI
  }
}
