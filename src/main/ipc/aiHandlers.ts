/**
 * AI IPC Handlers
 *
 * Handles IPC communication for AI-related operations including:
 * - Hardware detection
 * - Model recommendations
 * - Model management
 * - RAG / Vector Search
 *
 * Reference: docs/AI_ARCHITECTURE.md section 7
 */

import { ipcMain, BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { app } from 'electron'
import { join } from 'path'
import {
  HardwareDetector,
  ModelRegistry,
  ModelDownloader,
  AIManager,
  ConversationManager,
  VectorDBManager,
  EmbeddingService
} from '../ai'
import type { GenerationOptions, SearchResult } from '../ai'
import type { FileSystemManager, Note, FolderMetadata } from '../utils/fileSystem'

type GetFsManager = (spaceId: string) => FileSystemManager

// Singleton instances
let downloader: ModelDownloader | null = null
let aiManager: AIManager | null = null
let conversationManager: ConversationManager | null = null
let embeddingService: EmbeddingService | null = null

// Per-space VectorDBManager instances
const vectorDBManagers: Map<string, VectorDBManager> = new Map()

/**
 * Flag to track initialization state
 */
let isAIInitialized = false

/**
 * Get or create the ModelDownloader singleton
 */
async function getDownloader(): Promise<ModelDownloader> {
  if (!downloader) {
    downloader = new ModelDownloader()
    await downloader.initialize()
  }
  return downloader
}

/**
 * Get the AIManager singleton
 */
function getAIManager(): AIManager {
  if (!aiManager) {
    aiManager = AIManager.getInstance()
  }
  return aiManager
}

/**
 * Get the ConversationManager singleton
 */
function getConversationManager(): ConversationManager {
  if (!conversationManager) {
    const conversationsDir = join(app.getPath('userData'), 'conversations')
    conversationManager = ConversationManager.getInstance(conversationsDir)
  }
  return conversationManager
}

/**
 * Get the EmbeddingService singleton
 */
function getEmbeddingService(): EmbeddingService {
  if (!embeddingService) {
    embeddingService = new EmbeddingService(getAIManager())
  }
  return embeddingService
}

/**
 * Get or create VectorDBManager for a space
 */
function getOrCreateVectorDB(spaceId: string, getFsManager: GetFsManager): VectorDBManager {
  const existing = vectorDBManagers.get(spaceId)
  if (existing) return existing

  const fsManager = getFsManager(spaceId)
  const dbPath = fsManager.getDatabasePath()
  const instance = VectorDBManager.getInstance(spaceId, dbPath)
  vectorDBManagers.set(spaceId, instance)
  return instance
}

/**
 * Forward progress events to all BrowserWindows
 */
function setupProgressForwarding(dl: ModelDownloader): void {
  dl.on('progress', (progress) => {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('ai:download-progress', progress)
    }
  })
}

/**
 * Register AI-related IPC handlers
 */
export function registerAIHandlers(getOrCreateFsManager: GetFsManager): void {
  // Initialize downloader and setup progress forwarding
  getDownloader().then(setupProgressForwarding).catch(console.error)

  // ============================================================================
  // HARDWARE DETECTION
  // ============================================================================

  /**
   * Get system hardware information including CPU, RAM, GPU specs
   */
  ipcMain.handle('ai:getHardwareInfo', async (_event: IpcMainInvokeEvent) => {
    try {
      return await HardwareDetector.detect()
    } catch (error) {
      throw new Error(`Failed to detect hardware: ${(error as Error).message}`)
    }
  })

  /**
   * Get model recommendations based on detected hardware tier
   */
  ipcMain.handle('ai:getModelRecommendations', async (_event: IpcMainInvokeEvent) => {
    try {
      return await HardwareDetector.getModelRecommendations()
    } catch (error) {
      throw new Error(`Failed to get model recommendations: ${(error as Error).message}`)
    }
  })

  // ============================================================================
  // MODEL MANAGEMENT
  // ============================================================================

  /**
   * List all available models from the curated registry
   */
  ipcMain.handle('ai:listAvailableModels', (_event: IpcMainInvokeEvent) => {
    try {
      return ModelRegistry.getAllModels()
    } catch (error) {
      throw new Error(`Failed to list available models: ${(error as Error).message}`)
    }
  })

  /**
   * List all downloaded models
   */
  ipcMain.handle('ai:listDownloadedModels', async (_event: IpcMainInvokeEvent) => {
    try {
      const dl = await getDownloader()
      return await dl.getDownloadedModels()
    } catch (error) {
      throw new Error(`Failed to list downloaded models: ${(error as Error).message}`)
    }
  })

  /**
   * Check if a specific model is downloaded
   */
  ipcMain.handle('ai:isModelDownloaded', async (_event: IpcMainInvokeEvent, modelId: string) => {
    try {
      const dl = await getDownloader()
      return await dl.isModelDownloaded(modelId)
    } catch (error) {
      throw new Error(`Failed to check model status: ${(error as Error).message}`)
    }
  })

  /**
   * Start downloading a model
   */
  ipcMain.handle('ai:downloadModel', async (_event: IpcMainInvokeEvent, modelId: string) => {
    try {
      const model = ModelRegistry.getModel(modelId)
      if (!model) {
        throw new Error(`Unknown model: ${modelId}`)
      }

      const dl = await getDownloader()
      await dl.downloadModel(modelId, model.downloadUrl, model.filename)
      return { success: true }
    } catch (error) {
      throw new Error(`Failed to download model: ${(error as Error).message}`)
    }
  })

  /**
   * Pause an active download
   */
  ipcMain.handle('ai:pauseDownload', async (_event: IpcMainInvokeEvent, modelId: string) => {
    try {
      const dl = await getDownloader()
      dl.pauseDownload(modelId)
      return { success: true }
    } catch (error) {
      throw new Error(`Failed to pause download: ${(error as Error).message}`)
    }
  })

  /**
   * Resume a paused download
   */
  ipcMain.handle('ai:resumeDownload', async (_event: IpcMainInvokeEvent, modelId: string) => {
    try {
      const dl = await getDownloader()
      await dl.resumeDownload(modelId)
      return { success: true }
    } catch (error) {
      throw new Error(`Failed to resume download: ${(error as Error).message}`)
    }
  })

  /**
   * Cancel and cleanup a download
   */
  ipcMain.handle('ai:cancelDownload', async (_event: IpcMainInvokeEvent, modelId: string) => {
    try {
      const dl = await getDownloader()
      await dl.cancelDownload(modelId)
      return { success: true }
    } catch (error) {
      throw new Error(`Failed to cancel download: ${(error as Error).message}`)
    }
  })

  /**
   * Delete a downloaded model
   */
  ipcMain.handle('ai:deleteModel', async (_event: IpcMainInvokeEvent, modelId: string) => {
    try {
      const dl = await getDownloader()
      await dl.deleteModel(modelId)
      return { success: true }
    } catch (error) {
      throw new Error(`Failed to delete model: ${(error as Error).message}`)
    }
  })

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  /**
   * Initialize all AI components (AIManager, ModelDownloader, ConversationManager)
   */
  ipcMain.handle('ai:initialize', async (_event: IpcMainInvokeEvent) => {
    try {
      const manager = getAIManager()
      await manager.initialize()

      // Ensure downloader is initialized (already happens in getDownloader())
      await getDownloader()

      const convManager = getConversationManager()
      await convManager.initialize()

      isAIInitialized = true
      return { success: true }
    } catch (error) {
      throw new Error(`Failed to initialize AI: ${(error as Error).message}`)
    }
  })

  /**
   * Check if AI system is initialized
   */
  ipcMain.handle('ai:isInitialized', (_event: IpcMainInvokeEvent) => {
    return isAIInitialized && getAIManager().isInitialized()
  })

  // ============================================================================
  // MODEL LOADING
  // ============================================================================

  /**
   * Load a model into memory
   */
  ipcMain.handle('ai:loadModel', async (_event: IpcMainInvokeEvent, modelId: string) => {
    try {
      const manager = getAIManager()
      const result = await manager.loadModel(modelId)
      return { success: true, ...result }
    } catch (error) {
      throw new Error(`Failed to load model: ${(error as Error).message}`)
    }
  })

  /**
   * Unload a model from memory
   */
  ipcMain.handle('ai:unloadModel', async (_event: IpcMainInvokeEvent, modelId: string) => {
    try {
      const manager = getAIManager()
      await manager.unloadModel(modelId)
      return { success: true }
    } catch (error) {
      throw new Error(`Failed to unload model: ${(error as Error).message}`)
    }
  })

  /**
   * Get list of currently loaded models
   */
  ipcMain.handle('ai:getLoadedModels', (_event: IpcMainInvokeEvent) => {
    try {
      const manager = getAIManager()
      return manager.getLoadedModels()
    } catch (error) {
      throw new Error(`Failed to get loaded models: ${(error as Error).message}`)
    }
  })

  // ============================================================================
  // CHAT / INFERENCE
  // ============================================================================

  /**
   * Generate a response from the model with streaming support
   *
   * Iterates over the AsyncGenerator from AIManager.generateChatCompletion,
   * sending chunks via webContents.send('ai:response-chunk', { chunk, fullResponse })
   */
  ipcMain.handle(
    'ai:generateResponse',
    async (
      event: IpcMainInvokeEvent,
      modelId: string,
      messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
      options?: GenerationOptions
    ) => {
      try {
        const manager = getAIManager()

        let fullResponse = ''

        // Iterate over the async generator for streaming
        const generator = manager.generateChatCompletion(modelId, messages, options)

        for await (const chunk of generator) {
          fullResponse += chunk

          // Send chunk to renderer via webContents
          event.sender.send('ai:response-chunk', {
            chunk,
            fullResponse
          })
        }

        return { response: fullResponse }
      } catch (error) {
        throw new Error(`Failed to generate response: ${(error as Error).message}`)
      }
    }
  )

  // ============================================================================
  // VECTOR SEARCH / RAG
  // ============================================================================

  /**
   * Initialize vector database for a space
   */
  ipcMain.handle('ai:initializeVectorDB', async (_event: IpcMainInvokeEvent, spaceId: string) => {
    try {
      const vectorDB = getOrCreateVectorDB(spaceId, getOrCreateFsManager)
      await vectorDB.initialize()
      return { success: true }
    } catch (error) {
      throw new Error(`Failed to initialize vector DB: ${(error as Error).message}`)
    }
  })

  /**
   * Index a single note
   */
  ipcMain.handle(
    'ai:indexNote',
    async (_event: IpcMainInvokeEvent, spaceId: string, noteId: string, folderId: string) => {
      try {
        const vectorDB = getOrCreateVectorDB(spaceId, getOrCreateFsManager)
        if (!vectorDB.isInitialized()) {
          await vectorDB.initialize()
        }

        const fsManager = getOrCreateFsManager(spaceId)
        const note = await fsManager.readNote(folderId, noteId)

        // Convert Lexical content to markdown text
        const textContent = extractTextFromLexicalContent(note.content)

        const service = getEmbeddingService()
        await service.indexNote(
          {
            id: note.id,
            folderId: note.folderId,
            content: textContent,
            title: note.title,
            createdAt: note.createdAt,
            updatedAt: note.updatedAt
          },
          vectorDB
        )

        return { success: true, noteId }
      } catch (error) {
        throw new Error(`Failed to index note: ${(error as Error).message}`)
      }
    }
  )

  /**
   * Index all notes in a space
   * Sends progress events via 'ai:indexing-progress'
   */
  ipcMain.handle('ai:indexAllNotes', async (event: IpcMainInvokeEvent, spaceId: string) => {
    try {
      const vectorDB = getOrCreateVectorDB(spaceId, getOrCreateFsManager)
      if (!vectorDB.isInitialized()) {
        await vectorDB.initialize()
      }

      const fsManager = getOrCreateFsManager(spaceId)
      const service = getEmbeddingService()

      // Collect all notes recursively from folder tree
      const allNotes: Array<{ note: Note; folderId: string }> = []
      await collectNotesRecursively(fsManager, 'root', allNotes)

      const totalNotes = allNotes.length
      let completedNotes = 0
      let erroredNotes = 0

      // Send initial progress
      event.sender.send('ai:indexing-progress', {
        spaceId,
        completed: 0,
        total: totalNotes,
        currentNote: null,
        status: 'started'
      })

      // Index each note
      for (const { note, folderId } of allNotes) {
        try {
          // Send progress update for current note
          event.sender.send('ai:indexing-progress', {
            spaceId,
            completed: completedNotes,
            total: totalNotes,
            currentNote: { id: note.id, title: note.title },
            status: 'indexing'
          })

          // Convert Lexical content to markdown text
          const textContent = extractTextFromLexicalContent(note.content)

          await service.indexNote(
            {
              id: note.id,
              folderId,
              content: textContent,
              title: note.title,
              createdAt: note.createdAt,
              updatedAt: note.updatedAt
            },
            vectorDB
          )

          completedNotes++
        } catch (error) {
          console.error(`[ai:indexAllNotes] Failed to index note ${note.id}:`, error)
          erroredNotes++
          completedNotes++
        }
      }

      // Send completion progress
      event.sender.send('ai:indexing-progress', {
        spaceId,
        completed: totalNotes,
        total: totalNotes,
        currentNote: null,
        status: 'completed'
      })

      return {
        success: true,
        totalNotes,
        indexedNotes: completedNotes - erroredNotes,
        erroredNotes
      }
    } catch (error) {
      throw new Error(`Failed to index all notes: ${(error as Error).message}`)
    }
  })

  /**
   * Search notes using semantic similarity
   */
  ipcMain.handle(
    'ai:searchNotes',
    async (
      _event: IpcMainInvokeEvent,
      spaceId: string,
      query: string,
      limit?: number,
      noteIds?: string[]
    ): Promise<SearchResult[]> => {
      try {
        const vectorDB = getOrCreateVectorDB(spaceId, getOrCreateFsManager)
        if (!vectorDB.isInitialized()) {
          await vectorDB.initialize()
        }

        const service = getEmbeddingService()
        const queryEmbedding = await service.embedQuery(query)

        return await vectorDB.search(queryEmbedding, limit ?? 10, noteIds)
      } catch (error) {
        throw new Error(`Failed to search notes: ${(error as Error).message}`)
      }
    }
  )

  /**
   * Get list of indexed note IDs for a space
   */
  ipcMain.handle(
    'ai:getIndexedNotes',
    async (_event: IpcMainInvokeEvent, spaceId: string): Promise<string[]> => {
      try {
        const vectorDB = getOrCreateVectorDB(spaceId, getOrCreateFsManager)
        if (!vectorDB.isInitialized()) {
          await vectorDB.initialize()
        }

        return await vectorDB.getIndexedNoteIds()
      } catch (error) {
        throw new Error(`Failed to get indexed notes: ${(error as Error).message}`)
      }
    }
  )

  /**
   * Delete index for a specific note
   */
  ipcMain.handle(
    'ai:deleteNoteIndex',
    async (_event: IpcMainInvokeEvent, spaceId: string, noteId: string) => {
      try {
        const vectorDB = getOrCreateVectorDB(spaceId, getOrCreateFsManager)
        if (!vectorDB.isInitialized()) {
          await vectorDB.initialize()
        }

        await vectorDB.deleteDocumentsForNote(noteId)
        return { success: true, noteId }
      } catch (error) {
        throw new Error(`Failed to delete note index: ${(error as Error).message}`)
      }
    }
  )

  // ============================================================================
  // CONVERSATIONS
  // ============================================================================

  /**
   * Create a new conversation
   */
  ipcMain.handle(
    'ai:createConversation',
    async (_event: IpcMainInvokeEvent, title: string, modelId: string, systemPrompt?: string) => {
      try {
        const convManager = getConversationManager()
        if (!convManager.isInitialized()) {
          await convManager.initialize()
        }
        return await convManager.createConversation(title, modelId, systemPrompt)
      } catch (error) {
        throw new Error(`Failed to create conversation: ${(error as Error).message}`)
      }
    }
  )

  /**
   * Get a conversation by ID
   */
  ipcMain.handle('ai:getConversation', (_event: IpcMainInvokeEvent, conversationId: string) => {
    try {
      const convManager = getConversationManager()
      return convManager.getConversation(conversationId)
    } catch (error) {
      throw new Error(`Failed to get conversation: ${(error as Error).message}`)
    }
  })

  /**
   * List all conversations
   */
  ipcMain.handle('ai:listConversations', (_event: IpcMainInvokeEvent) => {
    try {
      const convManager = getConversationManager()
      return convManager.listConversations()
    } catch (error) {
      throw new Error(`Failed to list conversations: ${(error as Error).message}`)
    }
  })

  /**
   * Add a message to a conversation
   */
  ipcMain.handle(
    'ai:addMessage',
    async (
      _event: IpcMainInvokeEvent,
      conversationId: string,
      role: 'user' | 'assistant' | 'system',
      content: string,
      noteReferences?: Array<{
        noteId: string
        spaceId: string
        title: string
        excerpt: string
        relevanceScore?: number
      }>
    ) => {
      try {
        const convManager = getConversationManager()
        return await convManager.addMessage(conversationId, role, content, noteReferences)
      } catch (error) {
        throw new Error(`Failed to add message: ${(error as Error).message}`)
      }
    }
  )

  /**
   * Update conversation title
   */
  ipcMain.handle(
    'ai:updateConversationTitle',
    async (_event: IpcMainInvokeEvent, conversationId: string, title: string) => {
      try {
        const convManager = getConversationManager()
        await convManager.updateConversationTitle(conversationId, title)
        return { success: true }
      } catch (error) {
        throw new Error(`Failed to update conversation title: ${(error as Error).message}`)
      }
    }
  )

  /**
   * Add a note to conversation context
   */
  ipcMain.handle(
    'ai:addNoteToConversation',
    async (
      _event: IpcMainInvokeEvent,
      conversationId: string,
      noteRef: {
        noteId: string
        spaceId: string
        title: string
        excerpt: string
        relevanceScore?: number
      }
    ) => {
      try {
        const convManager = getConversationManager()
        await convManager.addNoteToContext(conversationId, noteRef)
        return { success: true }
      } catch (error) {
        throw new Error(`Failed to add note to conversation: ${(error as Error).message}`)
      }
    }
  )

  /**
   * Remove a note from conversation context
   */
  ipcMain.handle(
    'ai:removeNoteFromConversation',
    async (_event: IpcMainInvokeEvent, conversationId: string, noteId: string) => {
      try {
        const convManager = getConversationManager()
        await convManager.removeNoteFromContext(conversationId, noteId)
        return { success: true }
      } catch (error) {
        throw new Error(`Failed to remove note from conversation: ${(error as Error).message}`)
      }
    }
  )

  /**
   * Delete a conversation
   */
  ipcMain.handle(
    'ai:deleteConversation',
    async (_event: IpcMainInvokeEvent, conversationId: string) => {
      try {
        const convManager = getConversationManager()
        await convManager.deleteConversation(conversationId)
        return { success: true }
      } catch (error) {
        throw new Error(`Failed to delete conversation: ${(error as Error).message}`)
      }
    }
  )

  /**
   * Build context prompt from conversation's note references
   */
  ipcMain.handle('ai:buildContextPrompt', (_event: IpcMainInvokeEvent, conversationId: string) => {
    try {
      const convManager = getConversationManager()
      const conversation = convManager.getConversation(conversationId)
      if (!conversation) {
        throw new Error(`Conversation not found: ${conversationId}`)
      }
      return convManager.buildContextPrompt(conversation)
    } catch (error) {
      throw new Error(`Failed to build context prompt: ${(error as Error).message}`)
    }
  })

  /**
   * Search conversations by title
   */
  ipcMain.handle('ai:searchConversations', (_event: IpcMainInvokeEvent, query: string) => {
    try {
      const convManager = getConversationManager()
      return convManager.searchConversations(query)
    } catch (error) {
      throw new Error(`Failed to search conversations: ${(error as Error).message}`)
    }
  })
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Recursively collect all notes from a folder and its subfolders
 */
async function collectNotesRecursively(
  fsManager: FileSystemManager,
  folderId: string,
  result: Array<{ note: Note; folderId: string }>
): Promise<void> {
  const folderMeta: FolderMetadata = await fsManager.readFolderMetadata(folderId)

  // Get all notes in this folder
  for (const noteId of folderMeta.noteIds) {
    try {
      const note = await fsManager.readNote(folderId, noteId)
      result.push({ note, folderId })
    } catch (error) {
      console.error(`[collectNotesRecursively] Failed to read note ${noteId}:`, error)
    }
  }

  // Recurse into child folders
  for (const childFolderId of folderMeta.children) {
    await collectNotesRecursively(fsManager, childFolderId, result)
  }
}

/**
 * Extract plain text from Lexical editor serialized state
 *
 * Recursively walks the Lexical node tree and extracts text content.
 * Handles paragraph nodes, text nodes, heading nodes, list nodes, etc.
 */
function extractTextFromLexicalContent(content: unknown): string {
  // Handle case where content is already a markdown string
  if (typeof content === 'string') {
    return content
  }

  if (!content || typeof content !== 'object') {
    return ''
  }

  const state = content as { root?: { children?: unknown[] } }
  if (!state.root?.children) {
    return ''
  }

  const textParts: string[] = []

  function extractFromNode(node: unknown): void {
    if (!node || typeof node !== 'object') return

    const n = node as { type?: string; text?: string; children?: unknown[] }

    // Direct text node
    if (n.type === 'text' && typeof n.text === 'string') {
      textParts.push(n.text)
      return
    }

    // Block-level elements that should add newlines
    const blockTypes = ['paragraph', 'heading', 'quote', 'list', 'listitem']
    if (n.type && blockTypes.includes(n.type)) {
      if (textParts.length > 0 && !textParts[textParts.length - 1].endsWith('\n')) {
        textParts.push('\n')
      }
    }

    // Recurse into children
    if (Array.isArray(n.children)) {
      for (const child of n.children) {
        extractFromNode(child)
      }
    }

    // Add double newline after paragraphs for proper chunking
    if (n.type === 'paragraph' || n.type === 'heading') {
      textParts.push('\n')
    }
  }

  for (const child of state.root.children) {
    extractFromNode(child)
  }

  // Clean up: normalize whitespace and trim
  return textParts
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
