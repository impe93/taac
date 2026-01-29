import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// File System API
const fileSystemAPI = {
  // Note operations
  createNote: (spaceId: string, folderId: string, content: unknown, title: string) =>
    ipcRenderer.invoke('fs:createNote', spaceId, folderId, content, title),

  readNote: (spaceId: string, folderId: string, noteId: string) =>
    ipcRenderer.invoke('fs:readNote', spaceId, folderId, noteId),

  updateNote: (spaceId: string, folderId: string, noteId: string, updates: unknown) =>
    ipcRenderer.invoke('fs:updateNote', spaceId, folderId, noteId, updates),

  deleteNote: (spaceId: string, folderId: string, noteId: string) =>
    ipcRenderer.invoke('fs:deleteNote', spaceId, folderId, noteId),

  listNotes: (spaceId: string, folderId: string) =>
    ipcRenderer.invoke('fs:listNotes', spaceId, folderId),

  // Folder operations
  createFolder: (spaceId: string, name: string, parentId?: string) =>
    ipcRenderer.invoke('fs:createFolder', spaceId, name, parentId),

  readFolderMetadata: (spaceId: string, folderId: string) =>
    ipcRenderer.invoke('fs:readFolderMetadata', spaceId, folderId),

  updateFolderMetadata: (spaceId: string, folderId: string, updates: unknown) =>
    ipcRenderer.invoke('fs:updateFolderMetadata', spaceId, folderId, updates),

  deleteFolder: (spaceId: string, folderId: string) =>
    ipcRenderer.invoke('fs:deleteFolder', spaceId, folderId),

  getFolderTree: (spaceId: string) => ipcRenderer.invoke('fs:getFolderTree', spaceId),

  // Move operations
  moveNote: (spaceId: string, noteId: string, sourceFolderId: string, targetFolderId: string) =>
    ipcRenderer.invoke('fs:moveNote', spaceId, noteId, sourceFolderId, targetFolderId),

  moveFolder: (spaceId: string, folderId: string, targetParentId: string) =>
    ipcRenderer.invoke('fs:moveFolder', spaceId, folderId, targetParentId),

  // Cross-space move operations
  moveNoteToSpace: (
    sourceSpaceId: string,
    targetSpaceId: string,
    noteId: string,
    sourceFolderId: string
  ) =>
    ipcRenderer.invoke('fs:moveNoteToSpace', sourceSpaceId, targetSpaceId, noteId, sourceFolderId),

  moveFolderToSpace: (sourceSpaceId: string, targetSpaceId: string, folderId: string) =>
    ipcRenderer.invoke('fs:moveFolderToSpace', sourceSpaceId, targetSpaceId, folderId),

  // Asset operations
  saveAsset: (
    spaceId: string,
    originalName: string,
    buffer: Uint8Array,
    type: 'image' | 'pdf' | 'attachment'
  ) => ipcRenderer.invoke('fs:saveAsset', spaceId, originalName, buffer, type),

  readAsset: (spaceId: string, assetId: string, type: 'image' | 'pdf' | 'attachment') =>
    ipcRenderer.invoke('fs:readAsset', spaceId, assetId, type),

  deleteAsset: (spaceId: string, assetId: string, type: 'image' | 'pdf' | 'attachment') =>
    ipcRenderer.invoke('fs:deleteAsset', spaceId, assetId, type),

  // Database
  getDatabasePath: (spaceId: string) => ipcRenderer.invoke('fs:getDatabasePath', spaceId)
}

// Space API
const spaceAPI = {
  list: () => ipcRenderer.invoke('space:list'),

  get: (spaceId: string) => ipcRenderer.invoke('space:get', spaceId),

  create: (name: string, icon: string) => ipcRenderer.invoke('space:create', name, icon),

  update: (spaceId: string, updates: unknown) =>
    ipcRenderer.invoke('space:update', spaceId, updates),

  delete: (spaceId: string) => ipcRenderer.invoke('space:delete', spaceId)
}

// Config API
const configAPI = {
  get: (key: string) => ipcRenderer.invoke('config:get', key),

  set: (key: string, value: unknown) => ipcRenderer.invoke('config:set', key, value),

  getAll: () => ipcRenderer.invoke('config:getAll'),

  reset: () => ipcRenderer.invoke('config:reset'),

  onChange: (key: string, callback: (newValue: unknown, oldValue: unknown) => void) => {
    ipcRenderer.on('config:changed', (_event, { key: changedKey, newValue, oldValue }) => {
      if (changedKey === key) {
        callback(newValue, oldValue)
      }
    })
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('fileSystem', fileSystemAPI)
    contextBridge.exposeInMainWorld('config', configAPI)
    contextBridge.exposeInMainWorld('space', spaceAPI)
    contextBridge.exposeInMainWorld('platform', process.platform)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.fileSystem = fileSystemAPI
  // @ts-ignore (define in dts)
  window.config = configAPI
  // @ts-ignore (define in dts)
  window.space = spaceAPI
  // @ts-ignore (define in dts)
  window.platform = process.platform
}
