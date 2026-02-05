import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  Note,
  FolderMetadata,
  Asset,
  AppConfig,
  Space,
  MoveFolderToSpaceResult
} from './types'
import type {
  HardwareInfo,
  ModelRecommendation,
  ModelDefinition,
  DownloadProgress,
  LoadedModel,
  GenerationOptions,
  ChatCompletionResult,
  SearchResult,
  Conversation,
  ConversationSummary,
  NoteReference,
  ChatMessage
} from '../main/ai/types'

// Re-export types from types.ts for convenience
export type { Note, FolderMetadata, Asset, AppConfig, Space, MoveFolderToSpaceResult }

// Re-export AI types for convenience
export type {
  HardwareInfo,
  ModelRecommendation,
  ModelDefinition,
  DownloadProgress,
  LoadedModel,
  GenerationOptions,
  ChatCompletionResult,
  SearchResult,
  Conversation,
  ConversationSummary,
  NoteReference,
  ChatMessage
}

// Indexing progress data for vector search
export interface IndexingProgress {
  current: number
  total: number
  noteId: string
  noteTitle: string
}

// Embedding model status for RAG operations
export interface EmbeddingModelStatus {
  isAvailable: boolean
  modelId: string
  modelName: string
  sizeBytes?: number
  downloadUrl?: string
  error?: string
}

// File System API interface
export interface FileSystemAPI {
  // Note operations
  createNote: (spaceId: string, folderId: string, content: string, title: string) => Promise<Note>
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

  // Move operations
  moveNote: (
    spaceId: string,
    noteId: string,
    sourceFolderId: string,
    targetFolderId: string
  ) => Promise<Note>
  moveFolder: (spaceId: string, folderId: string, targetParentId: string) => Promise<FolderMetadata>

  // Cross-space move operations
  moveNoteToSpace: (
    sourceSpaceId: string,
    targetSpaceId: string,
    noteId: string,
    sourceFolderId: string
  ) => Promise<Note>
  moveFolderToSpace: (
    sourceSpaceId: string,
    targetSpaceId: string,
    folderId: string
  ) => Promise<MoveFolderToSpaceResult>

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

// Chat message type for inference
export interface ChatMessageInput {
  role: string
  content: string
}

// Response chunk data for streaming
export interface ResponseChunkData {
  chunk: string
  fullResponse: string
}

// AI API interface
export interface AIAPI {
  // Initialization
  initialize: () => Promise<void>
  isInitialized: () => Promise<boolean>

  // Hardware
  getHardwareInfo: () => Promise<HardwareInfo>
  getModelRecommendations: () => Promise<ModelRecommendation[]>

  // Models
  listAvailableModels: () => Promise<ModelDefinition[]>
  listDownloadedModels: () => Promise<ModelDefinition[]>
  isModelDownloaded: (modelId: string) => Promise<boolean>
  downloadModel: (modelId: string) => Promise<void>
  pauseDownload: (modelId: string) => Promise<void>
  resumeDownload: (modelId: string) => Promise<void>
  cancelDownload: (modelId: string) => Promise<void>
  loadModel: (modelId: string) => Promise<void>
  unloadModel: (modelId: string) => Promise<void>
  getLoadedModels: () => Promise<LoadedModel[]>
  deleteModel: (modelId: string) => Promise<void>

  // Download progress listener
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => () => void

  // Chat / Inference
  generateResponse: (
    modelId: string,
    messages: ChatMessageInput[],
    options?: { maxTokens?: number; temperature?: number }
  ) => Promise<ChatCompletionResult>
  onResponseChunk: (callback: (data: ResponseChunkData) => void) => () => void

  // Vector Search / RAG
  initializeVectorDB: (spaceId: string) => Promise<void>
  indexNote: (spaceId: string, noteId: string, folderId: string) => Promise<void>
  indexAllNotes: (spaceId: string) => Promise<void>
  searchNotes: (
    spaceId: string,
    query: string,
    limit?: number,
    noteIds?: string[]
  ) => Promise<SearchResult[]>
  getIndexedNotes: (spaceId: string) => Promise<string[]>
  deleteNoteIndex: (spaceId: string, noteId: string) => Promise<void>
  getEmbeddingModelStatus: () => Promise<EmbeddingModelStatus>
  onIndexingProgress: (callback: (data: IndexingProgress) => void) => () => void

  // Conversations
  createConversation: (
    title: string,
    modelId: string,
    systemPrompt?: string
  ) => Promise<Conversation>
  getConversation: (id: string) => Promise<Conversation>
  listConversations: () => Promise<ConversationSummary[]>
  addMessage: (
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
    noteRefs?: NoteReference[]
  ) => Promise<ChatMessage>
  updateConversationTitle: (conversationId: string, title: string) => Promise<Conversation>
  addNoteToConversation: (conversationId: string, noteRef: NoteReference) => Promise<Conversation>
  removeNoteFromConversation: (conversationId: string, noteId: string) => Promise<Conversation>
  deleteConversation: (id: string) => Promise<void>
}

// Global window interface
declare global {
  interface Window {
    electron: ElectronAPI
    fileSystem: FileSystemAPI
    config: ConfigAPI
    space: SpaceAPI
    platform: NodeJS.Platform
    ai: AIAPI
  }
}
