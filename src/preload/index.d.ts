import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  Note,
  FolderMetadata,
  OrderedItem,
  Asset,
  AppConfig,
  Space,
  MoveFolderToSpaceResult
} from './types'
import type {
  HardwareInfo,
  ModelRecommendation,
  ModelProfile,
  ModelDefinition,
  DownloadProgress,
  LoadedModel,
  GenerationOptions,
  ChatCompletionResult,
  SearchResult,
  RankedResult,
  ExpandedResult,
  Conversation,
  ConversationSummary,
  NoteReference,
  ChatMessage
} from '../main/ai/types'
import type {
  ImportSource,
  ImportOptions,
  ImportScanResult,
  ImportResult,
  ImportProgressEvent
} from '../main/import/types'

// Re-export types from types.ts for convenience
export type { Note, FolderMetadata, OrderedItem, Asset, AppConfig, Space, MoveFolderToSpaceResult }

// Re-export AI types for convenience
export type {
  HardwareInfo,
  ModelRecommendation,
  ModelProfile,
  ModelDefinition,
  DownloadProgress,
  LoadedModel,
  GenerationOptions,
  ChatCompletionResult,
  SearchResult,
  RankedResult,
  ExpandedResult,
  Conversation,
  ConversationSummary,
  NoteReference,
  ChatMessage
}

// Re-export import types for convenience
export type { ImportSource, ImportOptions, ImportScanResult, ImportResult, ImportProgressEvent }

// Indexing progress data for vector search
export interface IndexingProgress {
  current: number
  total: number
  noteId: string | null
  noteTitle: string | null
  status: 'checking' | 'indexing' | 'complete'
  staleCount?: number
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
  createNote: (
    spaceId: string,
    folderId: string,
    content: string,
    title: string,
    type?: 'note' | 'meeting'
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

  // Move operations
  moveNote: (
    spaceId: string,
    noteId: string,
    sourceFolderId: string,
    targetFolderId: string,
    targetIndex?: number
  ) => Promise<Note>
  moveFolder: (
    spaceId: string,
    folderId: string,
    targetParentId: string,
    targetIndex?: number
  ) => Promise<FolderMetadata>

  // Reorder interleaved children (notes + subfolders) of a folder
  reorderItems: (
    spaceId: string,
    parentFolderId: string,
    orderedItems: OrderedItem[]
  ) => Promise<FolderMetadata>

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
  ) => () => void
}

// Chat message type for inference
export interface ChatMessageInput {
  role: string
  content: string
}

// Response chunk data for streaming.
// `kind` distinguishes the main answer from the model's reasoning ("thought")
// segments; `fullThought` carries the accumulated reasoning text when kind === 'thought'.
export interface ResponseChunkData {
  chunk: string
  fullResponse: string
  kind?: 'response' | 'thought'
  fullThought?: string
}

// On-demand RAG options passed to generateResponse. When present, the model can
// call a `searchNotes` tool to retrieve notes only when needed.
export interface RagGenerationOptions {
  spaceId: string
  limit?: number
  noteIds?: string[]
}

// Generation options accepted by generateResponse over IPC
export interface GenerateResponseOptions {
  maxTokens?: number
  temperature?: number
  repeatPenalty?: number
  rag?: RagGenerationOptions
}

// Payload emitted when the model's searchNotes tool retrieves notes mid-generation
export interface RagRetrievalData {
  query: string
  results: ExpandedResult[]
}

// AI API interface
export interface AIAPI {
  // Initialization
  initialize: () => Promise<{ gpuFallback: boolean }>
  isInitialized: () => Promise<boolean>

  // Hardware
  getHardwareInfo: () => Promise<HardwareInfo>
  getModelRecommendations: () => Promise<ModelRecommendation[]>
  getModelProfile: () => Promise<ModelProfile>

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
    options?: GenerateResponseOptions
  ) => Promise<ChatCompletionResult>
  onResponseChunk: (callback: (data: ResponseChunkData) => void) => () => void
  onRagRetrieval: (callback: (data: RagRetrievalData) => void) => () => void
  stopGeneration: () => Promise<void>
  removeLastMessage: (conversationId: string) => Promise<void>

  // Vector Search / RAG
  initializeVectorDB: (spaceId: string) => Promise<void>
  indexNote: (spaceId: string, noteId: string, folderId: string) => Promise<void>
  indexAllNotes: (spaceId: string) => Promise<void>
  searchNotes: (
    spaceId: string,
    query: string,
    limit?: number,
    noteIds?: string[]
  ) => Promise<ExpandedResult[]>
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
  generateTitle: (
    modelId: string,
    userMessage: string,
    assistantResponse: string
  ) => Promise<string>

  // Embedding model needed event (broadcast at startup if model is missing)
  onEmbeddingModelNeeded: (callback: (data: { modelId: string }) => void) => () => void

  // Auto-index progress events from the batch-indexing scheduler (background)
  onAutoIndexProgress: (
    callback: (data: {
      spaceId: string
      noteId: string
      noteTitle: string
      status: 'queued' | 'indexing' | 'completed' | 'skipped' | 'error'
      queueSize: number
      error?: string
    }) => void
  ) => () => void
}

// Import API interface
export interface ImportAPI {
  selectFolder: () => Promise<string | null>
  scan: (sourcePath: string, source: ImportSource) => Promise<ImportScanResult>
  checkAppleNotesAccess: () => Promise<{ accessible: boolean; dbPath?: string; error?: string }>
  openSystemSettings: () => Promise<void>
  start: (options: ImportOptions) => Promise<ImportResult>
  onProgress: (callback: (event: ImportProgressEvent) => void) => () => void
}

// Processing progress data for meeting note pipeline
export interface ProcessingProgress {
  noteId: string
  stage: 'converting' | 'transcribing' | 'diarizing' | 'summarizing'
  percentage: number
  currentStage: number
  totalStages: number
  /** Ordered stage list for this run — 3 stages when realtime transcription was used */
  stages?: string[]
}

// Realtime transcription (macOS Apple Silicon — live segments during recording)
export interface RealtimeAvailability {
  available: boolean
  reason?:
    | 'unsupported-platform'
    | 'unsupported-os-version'
    | 'disabled-in-settings'
    | 'asr-model-missing'
    | 'vad-model-missing'
    | 'python-runtime-missing'
}

export interface RealtimeSegment {
  noteId: string
  track: 'mic' | 'system'
  /** Seconds from recording start (pause-compressed timeline) */
  startTime: number
  endTime: number
  text: string
  /** Normalized ISO 639-1 code detected for this utterance, '' when unknown */
  language: string
}

export interface RealtimeStatusEvent {
  noteId: string
  status: 'starting' | 'live' | 'failed' | 'stopped'
  message?: string
}

// Audio API interface
export interface AudioAPI {
  saveRecording: (
    noteId: string,
    spaceId: string,
    data: {
      micAudio: Uint8Array
      systemAudio?: Uint8Array
      mode: 'remote' | 'in-person'
      durationSecs?: number
      /** Preferred spoken language: 'auto' (detect) or an ISO 639-1 code */
      language?: string
    }
  ) => Promise<{ micPath: string; systemPath?: string }>
  processRecording: (
    noteId: string,
    spaceId: string
  ) => Promise<{
    metadata: import('./types').MeetingMetadata
    content: string
    summarizationError?: string
  }>
  cancelProcessing: (noteId: string) => Promise<void>
  onProcessingProgress: (callback: (progress: ProcessingProgress) => void) => () => void
  isTranscriptionModelDownloaded: () => Promise<boolean>
  regenerateSummary: (payload: {
    speakers: import('./types').Speaker[]
    transcription: import('./types').TranscriptionSegment[]
    language: string
  }) => Promise<{
    content: string
    actionItems: import('./types').ActionItem[]
    language: string
    summarizationError?: string
  }>
  hasStoredRecording: (noteId: string, spaceId: string) => Promise<boolean>
  reprocessFromDisk: (
    noteId: string,
    spaceId: string,
    options: {
      mode: 'remote' | 'in-person'
      recordingDate: string
      durationSecs: number
      language: string
    }
  ) => Promise<{
    metadata: import('./types').MeetingMetadata
    content: string
    summarizationError?: string
  }>
  // --- Realtime transcription (macOS Apple Silicon) ---
  isRealtimeAvailable: () => Promise<RealtimeAvailability>
  startRealtime: (
    noteId: string,
    options: { hasSystemTrack: boolean; language: string }
  ) => Promise<RealtimeAvailability>
  pushRealtimePcm: (noteId: string, track: 'mic' | 'system', pcm: ArrayBuffer) => void
  stopRealtime: (noteId: string) => Promise<{ hasTranscript: boolean }>
  abortRealtime: (noteId: string) => Promise<void>
  onRealtimeSegment: (callback: (segment: RealtimeSegment) => void) => () => void
  onRealtimeStatus: (callback: (status: RealtimeStatusEvent) => void) => () => void
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
    import: ImportAPI
    audio: AudioAPI
  }
}
