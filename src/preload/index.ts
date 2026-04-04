import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// File System API
const fileSystemAPI = {
  // Note operations
  createNote: (
    spaceId: string,
    folderId: string,
    content: unknown,
    title: string,
    type?: 'note' | 'meeting'
  ) => ipcRenderer.invoke('fs:createNote', spaceId, folderId, content, title, type),

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

// AI API
const aiAPI = {
  // Initialization
  initialize: () => ipcRenderer.invoke('ai:initialize'),

  isInitialized: () => ipcRenderer.invoke('ai:isInitialized'),

  // Hardware
  getHardwareInfo: () => ipcRenderer.invoke('ai:getHardwareInfo'),

  getModelRecommendations: () => ipcRenderer.invoke('ai:getModelRecommendations'),

  // Models
  listAvailableModels: () => ipcRenderer.invoke('ai:listAvailableModels'),

  listDownloadedModels: () => ipcRenderer.invoke('ai:listDownloadedModels'),

  isModelDownloaded: (modelId: string) => ipcRenderer.invoke('ai:isModelDownloaded', modelId),

  downloadModel: (modelId: string) => ipcRenderer.invoke('ai:downloadModel', modelId),

  pauseDownload: (modelId: string) => ipcRenderer.invoke('ai:pauseDownload', modelId),

  resumeDownload: (modelId: string) => ipcRenderer.invoke('ai:resumeDownload', modelId),

  cancelDownload: (modelId: string) => ipcRenderer.invoke('ai:cancelDownload', modelId),

  loadModel: (modelId: string) => ipcRenderer.invoke('ai:loadModel', modelId),

  unloadModel: (modelId: string) => ipcRenderer.invoke('ai:unloadModel', modelId),

  getLoadedModels: () => ipcRenderer.invoke('ai:getLoadedModels'),

  deleteModel: (modelId: string) => ipcRenderer.invoke('ai:deleteModel', modelId),

  // Download progress listener
  onDownloadProgress: (callback: (progress: unknown) => void) => {
    const handler = (_: unknown, progress: unknown): void => callback(progress)
    ipcRenderer.on('ai:download-progress', handler)
    return (): void => {
      ipcRenderer.removeListener('ai:download-progress', handler)
    }
  },

  // Chat / Inference
  generateResponse: (
    modelId: string,
    messages: Array<{ role: string; content: string }>,
    options?: { maxTokens?: number; temperature?: number; repeatPenalty?: number }
  ) => ipcRenderer.invoke('ai:generateResponse', modelId, messages, options),

  onResponseChunk: (callback: (data: { chunk: string; fullResponse: string }) => void) => {
    const handler = (_: unknown, data: { chunk: string; fullResponse: string }): void =>
      callback(data)
    ipcRenderer.on('ai:response-chunk', handler)
    return (): void => {
      ipcRenderer.removeListener('ai:response-chunk', handler)
    }
  },

  stopGeneration: () => ipcRenderer.invoke('ai:stopGeneration'),

  removeLastMessage: (conversationId: string) =>
    ipcRenderer.invoke('ai:removeLastMessage', conversationId),

  // Vector Search / RAG
  initializeVectorDB: (spaceId: string) => ipcRenderer.invoke('ai:initializeVectorDB', spaceId),

  indexNote: (spaceId: string, noteId: string, folderId: string) =>
    ipcRenderer.invoke('ai:indexNote', spaceId, noteId, folderId),

  indexAllNotes: (spaceId: string) => ipcRenderer.invoke('ai:indexAllNotes', spaceId),

  searchNotes: (spaceId: string, query: string, limit?: number, noteIds?: string[]) =>
    ipcRenderer.invoke('ai:searchNotes', spaceId, query, limit, noteIds),

  getIndexedNotes: (spaceId: string) => ipcRenderer.invoke('ai:getIndexedNotes', spaceId),

  deleteNoteIndex: (spaceId: string, noteId: string) =>
    ipcRenderer.invoke('ai:deleteNoteIndex', spaceId, noteId),

  getEmbeddingModelStatus: () => ipcRenderer.invoke('ai:getEmbeddingModelStatus'),

  onIndexingProgress: (
    callback: (data: {
      current: number
      total: number
      noteId: string | null
      noteTitle: string | null
      status: 'checking' | 'indexing' | 'complete'
      staleCount?: number
    }) => void
  ) => {
    const handler = (
      _: unknown,
      data: {
        current: number
        total: number
        noteId: string | null
        noteTitle: string | null
        status: 'checking' | 'indexing' | 'complete'
        staleCount?: number
      }
    ): void => callback(data)
    ipcRenderer.on('ai:indexing-progress', handler)
    return (): void => {
      ipcRenderer.removeListener('ai:indexing-progress', handler)
    }
  },

  // Conversations
  createConversation: (title: string, modelId: string, systemPrompt?: string) =>
    ipcRenderer.invoke('ai:createConversation', title, modelId, systemPrompt),

  getConversation: (id: string) => ipcRenderer.invoke('ai:getConversation', id),

  listConversations: () => ipcRenderer.invoke('ai:listConversations'),

  addMessage: (
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
    noteRefs?: Array<{ noteId: string; spaceId: string; title: string; excerpt: string }>
  ) => ipcRenderer.invoke('ai:addMessage', conversationId, role, content, noteRefs),

  updateConversationTitle: (conversationId: string, title: string) =>
    ipcRenderer.invoke('ai:updateConversationTitle', conversationId, title),

  addNoteToConversation: (
    conversationId: string,
    noteRef: { noteId: string; spaceId: string; title: string; excerpt: string }
  ) => ipcRenderer.invoke('ai:addNoteToConversation', conversationId, noteRef),

  removeNoteFromConversation: (conversationId: string, noteId: string) =>
    ipcRenderer.invoke('ai:removeNoteFromConversation', conversationId, noteId),

  deleteConversation: (id: string) => ipcRenderer.invoke('ai:deleteConversation', id),

  generateTitle: (modelId: string, userMessage: string, assistantResponse: string) =>
    ipcRenderer.invoke('ai:generateTitle', modelId, userMessage, assistantResponse),

  // Embedding model needed event (broadcast from main process at startup)
  onEmbeddingModelNeeded: (callback: (data: { modelId: string }) => void) => {
    const handler = (_: unknown, data: { modelId: string }): void => callback(data)
    ipcRenderer.on('ai:embedding-model-needed', handler)
    return (): void => {
      ipcRenderer.removeListener('ai:embedding-model-needed', handler)
    }
  },

  // Auto-index progress events from IndexingQueue (per-note background indexing)
  onAutoIndexProgress: (
    callback: (data: {
      spaceId: string
      noteId: string
      noteTitle: string
      status: 'queued' | 'indexing' | 'completed' | 'skipped' | 'error'
      queueSize: number
      error?: string
    }) => void
  ) => {
    const handler = (
      _: unknown,
      data: {
        spaceId: string
        noteId: string
        noteTitle: string
        status: 'queued' | 'indexing' | 'completed' | 'skipped' | 'error'
        queueSize: number
        error?: string
      }
    ): void => callback(data)
    ipcRenderer.on('ai:auto-index-progress', handler)
    return (): void => {
      ipcRenderer.removeListener('ai:auto-index-progress', handler)
    }
  }
}

// Import API
const importAPI = {
  selectFolder: () => ipcRenderer.invoke('import:selectFolder'),

  scan: (sourcePath: string, source: string) =>
    ipcRenderer.invoke('import:scan', sourcePath, source),

  checkAppleNotesAccess: () => ipcRenderer.invoke('import:checkAppleNotesAccess'),

  openSystemSettings: () =>
    ipcRenderer.invoke(
      'shell:openExternal',
      'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'
    ),

  start: (options: unknown) => ipcRenderer.invoke('import:start', options),

  onProgress: (callback: (event: unknown) => void) => {
    const handler = (_: unknown, event: unknown): void => callback(event)
    ipcRenderer.on('import:progress', handler)
    return (): void => {
      ipcRenderer.removeListener('import:progress', handler)
    }
  }
}

// Audio API
const audioAPI = {
  saveRecording: (
    noteId: string,
    spaceId: string,
    data: {
      micAudio: Uint8Array
      systemAudio?: Uint8Array
      mode: 'remote' | 'in-person'
      durationSecs?: number
    }
  ) => ipcRenderer.invoke('audio:saveRecording', noteId, spaceId, data),

  processRecording: (noteId: string, spaceId: string) =>
    ipcRenderer.invoke('audio:processRecording', noteId, spaceId),

  cancelProcessing: (noteId: string) => ipcRenderer.invoke('audio:cancelProcessing', noteId),

  onProcessingProgress: (callback: (progress: unknown) => void) => {
    const handler = (_: unknown, progress: unknown): void => callback(progress)
    ipcRenderer.on('audio:processing-progress', handler)
    return (): void => {
      ipcRenderer.removeListener('audio:processing-progress', handler)
    }
  },

  isTranscriptionModelDownloaded: () => ipcRenderer.invoke('audio:isTranscriptionModelDownloaded')
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
    contextBridge.exposeInMainWorld('ai', aiAPI)
    contextBridge.exposeInMainWorld('import', importAPI)
    contextBridge.exposeInMainWorld('audio', audioAPI)
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
  // @ts-ignore (define in dts)
  window.ai = aiAPI
  // @ts-ignore (define in dts)
  window.import = importAPI
  // @ts-ignore (define in dts)
  window.audio = audioAPI
}
