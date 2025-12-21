import { ElectronAPI } from '@electron-toolkit/preload'
import type { SerializedEditorState } from 'lexical'
import type { Note, FolderMetadata, Asset, AppConfig, Space } from './types'

// Re-export types from types.ts for convenience
export type { Note, FolderMetadata, Asset, AppConfig, Space }

// File System API interface
export interface FileSystemAPI {
  // Note operations
  createNote: (
    spaceId: string,
    folderId: string,
    content: SerializedEditorState,
    title: string
  ) => Promise<Note>
  readNote: (spaceId: string, folderId: string, noteId: string) => Promise<Note>
  updateNote: (
    spaceId: string,
    folderId: string,
    noteId: string,
    updates: Partial<Note>
  ) => Promise<Note>
  deleteNote: (spaceId: string, folderId: string, noteId: string) => Promise<void>
  listNotes: (spaceId: string, folderId: string) => Promise<Note[]>

  // Folder operations
  createFolder: (spaceId: string, name: string, parentId?: string) => Promise<FolderMetadata>
  readFolderMetadata: (spaceId: string, folderId: string) => Promise<FolderMetadata>
  updateFolderMetadata: (
    spaceId: string,
    folderId: string,
    updates: Partial<FolderMetadata>
  ) => Promise<FolderMetadata>
  deleteFolder: (spaceId: string, folderId: string) => Promise<void>
  getFolderTree: (spaceId: string) => Promise<FolderMetadata>

  // Asset operations
  saveAsset: (
    spaceId: string,
    originalName: string,
    buffer: Uint8Array,
    type: 'image' | 'pdf' | 'attachment'
  ) => Promise<Asset>
  readAsset: (
    spaceId: string,
    assetId: string,
    type: 'image' | 'pdf' | 'attachment'
  ) => Promise<Buffer>
  deleteAsset: (
    spaceId: string,
    assetId: string,
    type: 'image' | 'pdf' | 'attachment'
  ) => Promise<void>

  // Database
  getDatabasePath: (spaceId: string) => Promise<string>
}

// Space API interface
export interface SpaceAPI {
  list: () => Promise<Space[]>
  get: (spaceId: string) => Promise<Space>
  create: (name: string, icon: string) => Promise<Space>
  update: (spaceId: string, updates: Partial<Space>) => Promise<Space>
  delete: (spaceId: string) => Promise<void>
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
    space: SpaceAPI
  }
}
