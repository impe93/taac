import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// File System API
const fileSystemAPI = {
  // Note operations
  createNote: (folderId: string, content: unknown, title: string) =>
    ipcRenderer.invoke('fs:createNote', folderId, content, title),

  readNote: (folderId: string, noteId: string) =>
    ipcRenderer.invoke('fs:readNote', folderId, noteId),

  updateNote: (folderId: string, noteId: string, updates: unknown) =>
    ipcRenderer.invoke('fs:updateNote', folderId, noteId, updates),

  deleteNote: (folderId: string, noteId: string) =>
    ipcRenderer.invoke('fs:deleteNote', folderId, noteId),

  listNotes: (folderId: string) => ipcRenderer.invoke('fs:listNotes', folderId),

  // Folder operations
  createFolder: (name: string, parentId?: string) =>
    ipcRenderer.invoke('fs:createFolder', name, parentId),

  readFolderMetadata: (folderId: string) => ipcRenderer.invoke('fs:readFolderMetadata', folderId),

  updateFolderMetadata: (folderId: string, updates: unknown) =>
    ipcRenderer.invoke('fs:updateFolderMetadata', folderId, updates),

  deleteFolder: (folderId: string) => ipcRenderer.invoke('fs:deleteFolder', folderId),

  getFolderTree: () => ipcRenderer.invoke('fs:getFolderTree'),

  // Asset operations
  saveAsset: (originalName: string, buffer: Uint8Array, type: 'image' | 'pdf' | 'attachment') =>
    ipcRenderer.invoke('fs:saveAsset', originalName, buffer, type),

  readAsset: (assetId: string, type: 'image' | 'pdf' | 'attachment') =>
    ipcRenderer.invoke('fs:readAsset', assetId, type),

  deleteAsset: (assetId: string, type: 'image' | 'pdf' | 'attachment') =>
    ipcRenderer.invoke('fs:deleteAsset', assetId, type),

  // Database
  getDatabasePath: () => ipcRenderer.invoke('fs:getDatabasePath')
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
}
