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
import fs from 'node:fs'
import {
  HardwareDetector,
  ModelRegistry,
  ModelSelector,
  ModelDownloader,
  AIManager,
  ConversationManager,
  VectorDBManager,
  EmbeddingService,
  IndexingQueue,
  RerankerService,
  QueryExpander
} from '../ai'
import type {
  GenerationOptions,
  ExpandedResult,
  IndexingProgressEvent,
  ChatRetrievalTool
} from '../ai'
import type { FileSystemManager, Note, FolderMetadata } from '../utils/fileSystem'
import { configStore } from '../utils/configStore'

type GetFsManager = (spaceId: string) => FileSystemManager

function writeAILog(message: string): void {
  try {
    const logDir = app.getPath('logs')
    const logFile = join(logDir, 'ai.log')
    const timestamp = new Date().toISOString()
    fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`)
  } catch {
    // ignore logging errors
  }
}

// Singleton instances
let downloader: ModelDownloader | null = null
let aiManager: AIManager | null = null
let conversationManager: ConversationManager | null = null
let embeddingService: EmbeddingService | null = null
let indexingQueue: IndexingQueue | null = null
let rerankerService: RerankerService | null = null

// Per-space VectorDBManager instances
const vectorDBManagers: Map<string, VectorDBManager> = new Map()

// AbortController for batch indexing (ai:indexAllNotes)
let batchIndexAbort: AbortController | null = null

// AbortController for active chat generation (ai:generateResponse)
let generationAbort: AbortController | null = null

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
 * Get the RerankerService singleton (lazy, returns null if reranker model not downloaded)
 */
async function getRerankerServiceIfAvailable(): Promise<RerankerService | null> {
  try {
    const dl = await getDownloader()
    const rerankerModels = ModelRegistry.getRerankerModels()
    if (rerankerModels.length === 0) return null

    const rerankerModelId = rerankerModels[0].id
    const isDownloaded = await dl.isModelDownloaded(rerankerModelId)
    if (!isDownloaded) return null

    if (!rerankerService) {
      rerankerService = RerankerService.getInstance(getAIManager(), rerankerModelId)
    }
    return rerankerService
  } catch {
    return null
  }
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
 * Run the hybrid RAG search pipeline for a query and return ranked results.
 *
 * Pipeline: Query → [Expand] → Multi-query Hybrid Search → RRF Merge → [Rerank] → Results
 *
 * Shared by the `ai:searchNotes` IPC handler (renderer-driven search) and the
 * on-demand `searchNotes` chat tool (model-driven retrieval). The `expandQuery`
 * flag lets the tool path skip query expansion — expansion invokes the chat
 * model, which is undesirable (re-entrant + slow) while a generation is in
 * flight, so the tool path passes `expandQuery: false`.
 */
async function runNoteSearch(
  getFsManager: GetFsManager,
  spaceId: string,
  query: string,
  opts?: { limit?: number; noteIds?: string[]; expandQuery?: boolean }
): Promise<ExpandedResult[]> {
  const { limit, noteIds, expandQuery = true } = opts ?? {}

  // Ensure AIManager is initialized (required for embedding generation)
  const manager = getAIManager()
  if (!manager.isInitialized()) await manager.initialize()

  const vectorDB = getOrCreateVectorDB(spaceId, getFsManager)
  if (!vectorDB.isInitialized()) await vectorDB.initialize()

  const service = getEmbeddingService()
  const retrievalLimit = limit ?? 10

  // --- Step 1: Query Expansion ---
  // If a chat model is loaded (and expansion is allowed), expand the query for
  // better recall.
  let queries = [query]
  if (expandQuery) {
    const loadedModels = manager.getLoadedModels()
    const chatModels = ModelRegistry.getChatModels()
    const loadedChatModel = loadedModels.find((lm) => chatModels.some((cm) => cm.id === lm.id))

    if (loadedChatModel) {
      try {
        const expander = new QueryExpander(manager)
        queries = await expander.expandQuery(query, loadedChatModel.id)
        if (queries.length > 1) {
          console.log(`[RAG] Query expanded: ${queries.length} variants`)
        }
      } catch {
        queries = [query]
      }
    }
  }

  // --- Step 2: Multi-query Hybrid Search ---
  // Retrieve a wide candidate pool so the cross-encoder reranker has enough
  // to work with — the reranker is the authority on final precision.
  const candidateLimit = Math.max(retrievalLimit * 6, 40)

  let allResults: ExpandedResult[]

  if (queries.length === 1) {
    // Single query — standard path
    const queryEmbeddingArray = await service.embedQuery(queries[0])
    const queryEmbedding = new Float32Array(queryEmbeddingArray)
    allResults = vectorDB.hybridSearch({
      query: queries[0],
      queryEmbedding,
      limit: candidateLimit,
      noteIds
    })
  } else {
    // Multi-query — search each variant and merge via deduplication
    const allEmbeddings = await Promise.all(queries.map((q) => service.embedQuery(q)))

    const resultSets = queries.map((q, i) =>
      vectorDB.hybridSearch({
        query: q,
        queryEmbedding: new Float32Array(allEmbeddings[i]),
        limit: candidateLimit,
        noteIds
      })
    )

    // Merge results: RRF across query variants (deduplicate by chunk ID)
    const mergedMap = new Map<string, ExpandedResult>()
    for (const resultSet of resultSets) {
      for (const result of resultSet) {
        const existing = mergedMap.get(result.id)
        if (existing) {
          // Accumulate RRF scores from multiple queries
          existing.rrfScore += result.rrfScore
        } else {
          mergedMap.set(result.id, { ...result })
        }
      }
    }

    allResults = Array.from(mergedMap.values()).sort((a, b) => b.rrfScore - a.rrfScore)
  }

  if (allResults.length === 0) return allResults

  // --- Step 3: Cross-encoder Reranking ---
  const reranker = await getRerankerServiceIfAvailable()
  if (reranker) {
    try {
      // Build enriched content for reranking (include folder path and title metadata)
      const rerankDocs = allResults.map((r) => {
        const meta = r.metadata as Record<string, unknown>
        const folderPath = meta?.folderPath as string | undefined
        const noteTitle = meta?.noteTitle as string | undefined
        const parts: string[] = []
        if (folderPath) parts.push(`Path: "${folderPath}"`)
        if (noteTitle) parts.push(`Note: "${noteTitle}"`)
        if (r.sectionHeader) parts.push(`Section: "${r.sectionHeader}"`)
        parts.push(r.expandedContent || r.content)
        return { id: r.id, content: parts.join(' | ') }
      })

      const reranked = await reranker.rerank(query, rerankDocs)

      // Build a score map from reranker results (scores are calibrated 0..1)
      const rerankerScoreMap = new Map(reranked.map((r) => [r.id, r.score]))

      // The cross-encoder is the authority on final ordering. RRF is kept
      // only as a tiny tiebreak so equal reranker scores fall back to the
      // first-stage hybrid ranking.
      const maxRRF = Math.max(...allResults.map((r) => r.rrfScore), 1e-9)
      const scored = allResults.map((r) => {
        const rerankerScore = rerankerScoreMap.get(r.id) ?? 0
        const finalScore = rerankerScore + 0.001 * (r.rrfScore / maxRRF)
        return { result: r, rerankerScore, finalScore }
      })

      scored.sort((a, b) => b.finalScore - a.finalScore)

      // Calibrated relevance: the reranker score is an absolute 0..1
      // probability — far more meaningful than "% of the best in the set".
      return scored.slice(0, retrievalLimit).map(({ result, rerankerScore }) => ({
        ...result,
        rerankerScore,
        relevancePercent: Math.round(rerankerScore * 100)
      }))
    } catch (rerankError) {
      // Graceful degradation: if reranking fails, return original results
      console.error('[RAG] Reranking failed, using RRF results:', rerankError)
    }
  }

  // No reranker available — return RRF results with limit
  const topResults = allResults.slice(0, retrievalLimit)
  const maxRRF = topResults.length > 0 ? topResults[0].rrfScore : 1
  return topResults.map((r) => ({
    ...r,
    relevancePercent: Math.round((r.rrfScore / maxRRF) * 100)
  }))
}

/**
 * Get or create the IndexingQueue singleton.
 *
 * The queue requires EmbeddingService and a way to get VectorDBManagers.
 * It won't process jobs until setEmbeddingAvailable(true) is called.
 */
function getOrCreateIndexingQueue(getFsManager: GetFsManager): IndexingQueue {
  if (!indexingQueue) {
    indexingQueue = new IndexingQueue(getEmbeddingService(), (spaceId: string) =>
      getOrCreateVectorDB(spaceId, getFsManager)
    )

    // Forward auto-index progress events to all BrowserWindows
    indexingQueue.on('progress', (event: IndexingProgressEvent) => {
      const windows = BrowserWindow.getAllWindows()
      for (const win of windows) {
        if (!win.webContents.isDestroyed()) {
          win.webContents.send('ai:auto-index-progress', event)
        }
      }
    })
  }
  return indexingQueue
}

/**
 * Try to enable auto-indexing if the embedding model is downloaded.
 * Called after AI initialization and model downloads.
 */
async function tryEnableAutoIndexing(getFsManager: GetFsManager): Promise<void> {
  try {
    const service = getEmbeddingService()
    const modelId = service.getEmbeddingModel()
    const dl = await getDownloader()
    const isDownloaded = await dl.isModelDownloaded(modelId)

    const queue = getOrCreateIndexingQueue(getFsManager)
    queue.setEmbeddingAvailable(isDownloaded)

    if (isDownloaded) {
      console.log('[IndexingQueue] Auto-indexing enabled — embedding model available')
    }
  } catch (error) {
    console.error('[IndexingQueue] Failed to check embedding model availability:', error)
  }
}

/**
 * Initialize the embedding subsystem at app startup (deferred).
 *
 * Performs a lightweight check: if the embedding model is already downloaded,
 * initializes AIManager and enables the IndexingQueue. If the model is missing,
 * broadcasts 'ai:embedding-model-needed' to prompt the user.
 *
 * Safe to call multiple times — AIManager.initialize() is idempotent.
 */
export async function initializeEmbeddingSubsystem(getFsManager: GetFsManager): Promise<void> {
  try {
    const dl = await getDownloader()
    const service = getEmbeddingService()
    const modelId = service.getEmbeddingModel()
    const isDownloaded = await dl.isModelDownloaded(modelId)

    if (!isDownloaded) {
      console.log('[EmbeddingInit] Embedding model not downloaded — auto-indexing deferred')
      const windows = BrowserWindow.getAllWindows()
      for (const win of windows) {
        win.webContents.send('ai:embedding-model-needed', { modelId })
      }
      return
    }

    // Initialize AIManager (idempotent — safe if called again later from AIChatPanel)
    const manager = getAIManager()
    await manager.initialize()
    isAIInitialized = true

    // Enable the indexing queue
    await tryEnableAutoIndexing(getFsManager)

    console.log('[EmbeddingInit] Embedding subsystem ready — auto-indexing enabled')
  } catch (error) {
    console.error('[EmbeddingInit] Failed:', error)
  }
}

/**
 * Notify that a note was saved. Enqueues background indexing (debounced).
 *
 * This function is non-blocking: it extracts text from the Lexical content
 * and enqueues it for later processing. Returns immediately.
 *
 * Called from fileHandlers after fs:updateNote / fs:createNote.
 */
export function notifyNoteSaved(
  noteId: string,
  spaceId: string,
  folderId: string,
  rawContent: unknown,
  title: string,
  folderPath?: string
): void {
  if (!indexingQueue) return

  // Check if auto-indexing is enabled in user config
  if (configStore.get('autoIndexNotes') === false) return

  // Extract text from Lexical editor state
  const textContent = extractTextFromLexicalContent(rawContent)
  if (!textContent.trim()) return

  indexingQueue.enqueue(noteId, spaceId, folderId, textContent, title, folderPath)
}

/**
 * Re-index all notes in a moved folder subtree with their updated folder paths.
 * Called from fileHandlers after fs:moveFolder succeeds.
 */
export async function notifyFolderMoved(
  getOrCreateFsManager: GetFsManager,
  spaceId: string,
  movedFolderId: string
): Promise<void> {
  if (!indexingQueue) return

  const fsManager = getOrCreateFsManager(spaceId)
  const allNotes: Array<{ note: Note; folderId: string }> = []

  try {
    await collectNotesRecursively(fsManager, movedFolderId, allNotes)
  } catch (error) {
    console.error(`[notifyFolderMoved] Failed to collect notes for folder ${movedFolderId}:`, error)
    return
  }

  for (const { note, folderId } of allNotes) {
    const textContent = extractTextFromLexicalContent(note.content)
    if (!textContent.trim()) continue

    let folderPath: string | undefined
    try {
      folderPath = await fsManager.getFullFolderPath(folderId)
    } catch {
      /* ignore */
    }

    indexingQueue.enqueue(note.id, spaceId, folderId, textContent, note.title, folderPath)
  }
}

/**
 * Dispose the IndexingQueue (e.g. when app is closing).
 */
export function disposeIndexingQueue(): void {
  if (indexingQueue) {
    indexingQueue.dispose()
    indexingQueue = null
  }
}

/**
 * Cancel any running batch indexing (ai:indexAllNotes).
 * Safe to call even if no batch is running.
 */
export function cancelBatchIndexing(): void {
  if (batchIndexAbort) {
    batchIndexAbort.abort()
    batchIndexAbort = null
  }
}

/**
 * Tear down AI native resources before the Node/Electron environment exits.
 * Must complete before app.quit() proceeds — llama.cpp async workers crash
 * if their N-API callbacks fire during FreeEnvironment.
 */
export async function disposeAISubsystem(): Promise<void> {
  if (generationAbort) {
    generationAbort.abort()
    generationAbort = null
  }

  cancelBatchIndexing()
  disposeIndexingQueue()

  if (rerankerService) {
    try {
      await rerankerService.dispose()
    } catch (error) {
      console.error('[AI] RerankerService dispose failed:', error)
    }
    rerankerService = null
  }

  const manager = aiManager
  if (manager?.isInitialized()) {
    try {
      await manager.dispose()
    } catch (error) {
      console.error('[AI] AIManager dispose failed:', error)
    }
  }

  for (const [spaceId, vdb] of vectorDBManagers) {
    try {
      await vdb.close()
    } catch (error) {
      console.error(`[AI] VectorDB close failed for space ${spaceId}:`, error)
    }
  }
  vectorDBManagers.clear()

  aiManager = null
  isAIInitialized = false
}

/**
 * Safely send an IPC event to a webContents sender.
 * Checks if the sender is destroyed before sending to avoid errors
 * when the window is closed during batch processing.
 */
function safeSend(sender: Electron.WebContents, channel: string, data: unknown): void {
  if (!sender.isDestroyed()) {
    sender.send(channel, data)
  }
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
   * Get hardware-aware model profile for Settings and onboarding
   */
  ipcMain.handle('ai:getModelProfile', async (_event: IpcMainInvokeEvent) => {
    try {
      const hardware = await HardwareDetector.detect()
      return ModelSelector.getModelProfile(hardware)
    } catch (error) {
      throw new Error(`Failed to get model profile: ${(error as Error).message}`)
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

      // Bootstrap embedding subsystem after model download — enables auto-indexing
      // even if the user hasn't opened the chat panel yet
      await initializeEmbeddingSubsystem(getOrCreateFsManager)

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
      const { gpuFallback } = await manager.initialize()

      // Ensure downloader is initialized (already happens in getDownloader())
      await getDownloader()

      const convManager = getConversationManager()
      await convManager.initialize()

      isAIInitialized = true

      // Enable auto-indexing if embedding model is available
      await tryEnableAutoIndexing(getOrCreateFsManager)

      return { success: true, gpuFallback }
    } catch (error) {
      const errorMsg = (error as Error).stack ?? String(error)
      writeAILog(`[ai:initialize] FAILED: ${errorMsg}`)
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

        // Create AbortController for this generation
        generationAbort = new AbortController()
        const { signal } = generationAbort

        let fullResponse = ''

        // Build the on-demand RAG retrieval tool when the renderer requested it
        // (RAG enabled + embedding model available). The model decides whether to
        // call `searchNotes`; each retrieval emits `ai:rag-retrieval` so the
        // renderer can surface the "searching" stage, the context chips, and
        // persist the note references on the assistant message.
        const ragOptions = options?.rag
        const retrieval: ChatRetrievalTool | undefined = ragOptions
          ? {
              multiSearch: configStore.get('ragMultiSearch') !== false,
              async search(query: string): Promise<ExpandedResult[]> {
                const results = await runNoteSearch(
                  getOrCreateFsManager,
                  ragOptions.spaceId,
                  query,
                  {
                    limit: ragOptions.limit,
                    noteIds: ragOptions.noteIds,
                    // Skip query expansion in the tool path: it would invoke the chat
                    // model re-entrantly mid-generation (slow on mid-end hardware).
                    expandQuery: false
                  }
                )
                if (!event.sender.isDestroyed()) {
                  event.sender.send('ai:rag-retrieval', { query, results })
                }
                return results
              }
            }
          : undefined

        // Forward reasoning ("thought") segments to the renderer on the same
        // channel, tagged with kind so the UI can show a collapsible thinking
        // panel that auto-collapses once the real answer starts streaming.
        const onThought = (delta: string, fullThought: string): void => {
          if (signal.aborted || event.sender.isDestroyed()) return
          event.sender.send('ai:response-chunk', {
            chunk: delta,
            fullResponse,
            kind: 'thought',
            fullThought
          })
        }

        // Iterate over the async generator for streaming
        const generator = manager.generateChatCompletion(
          modelId,
          messages,
          options,
          signal,
          retrieval,
          onThought
        )

        for await (const chunk of generator) {
          // Check if aborted between chunks
          if (signal.aborted) break

          fullResponse += chunk

          // Send chunk to renderer via webContents
          event.sender.send('ai:response-chunk', {
            chunk,
            fullResponse,
            kind: 'response'
          })
        }

        const wasAborted = signal.aborted
        generationAbort = null

        if (wasAborted) {
          return { response: '', aborted: true }
        }

        return { response: fullResponse }
      } catch (error) {
        generationAbort = null
        // If error is due to abort, return aborted result instead of throwing
        if ((error as Error).name === 'AbortError') {
          return { response: '', aborted: true }
        }
        throw new Error(`Failed to generate response: ${(error as Error).message}`)
      }
    }
  )

  /**
   * Stop an in-flight chat generation by aborting the AbortController
   */
  ipcMain.handle('ai:stopGeneration', async () => {
    if (generationAbort) {
      generationAbort.abort()
      generationAbort = null
    }
  })

  /**
   * Remove the last message from a conversation (used when generation is aborted)
   */
  ipcMain.handle(
    'ai:removeLastMessage',
    async (_event: IpcMainInvokeEvent, conversationId: string) => {
      try {
        const convManager = getConversationManager()
        await convManager.removeLastMessage(conversationId)
      } catch (error) {
        throw new Error(`Failed to remove last message: ${(error as Error).message}`)
      }
    }
  )

  /**
   * Generate a short conversation title from the first user/assistant exchange.
   * Does NOT stream — returns the title string directly.
   */
  ipcMain.handle(
    'ai:generateTitle',
    async (
      _event: IpcMainInvokeEvent,
      modelId: string,
      userMessage: string,
      assistantResponse: string
    ): Promise<string> => {
      try {
        const manager = getAIManager()
        const titleMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
          {
            role: 'system',
            content:
              'Generate a concise 2-5 word title that captures the main topic of this conversation. Output ONLY the title, nothing else. No quotes, no punctuation, no prefixes.'
          },
          {
            role: 'user',
            content: `User: ${userMessage.slice(0, 200)}\nAssistant: ${assistantResponse.slice(0, 200)}`
          }
        ]

        let rawTitle = ''
        const generator = manager.generateChatCompletion(modelId, titleMessages, {
          maxTokens: 20,
          temperature: 0.3,
          isolated: true
        })
        for await (const chunk of generator) {
          rawTitle += chunk
        }

        return rawTitle
      } catch (error) {
        throw new Error(`Failed to generate title: ${(error as Error).message}`)
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
        // Ensure AIManager is initialized (required for embedding generation)
        const manager = getAIManager()
        if (!manager.isInitialized()) {
          await manager.initialize()
        }

        // Check if embedding model is available
        const service = getEmbeddingService()
        const modelId = service.getEmbeddingModel()
        const dl = await getDownloader()
        const isDownloaded = await dl.isModelDownloaded(modelId)

        if (!isDownloaded) {
          throw new Error(
            `The embedding model "${modelId}" is not downloaded. Download it before indexing notes.`
          )
        }

        const vectorDB = getOrCreateVectorDB(spaceId, getOrCreateFsManager)
        if (!vectorDB.isInitialized()) {
          await vectorDB.initialize()
        }

        const fsManager = getOrCreateFsManager(spaceId)
        const note = await fsManager.readNote(folderId, noteId)

        // Convert Lexical content to markdown text
        const textContent = extractTextFromLexicalContent(note.content)

        // Resolve full folder path for semantic search
        let folderPath: string | undefined
        try {
          folderPath = await fsManager.getFullFolderPath(note.folderId)
        } catch {
          /* ignore */
        }

        await service.indexNote(
          {
            id: note.id,
            folderId: note.folderId,
            folderPath,
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
   * Index all notes in a space (two-phase: hash-check then index stale only).
   *
   * Phase 1 (checking): Extract text + content-hash check for every note.
   * Phase 2 (indexing): Embed only the stale notes.
   *
   * Sends 'ai:indexing-progress' events with status: 'checking' | 'indexing' | 'complete'.
   * Supports cancellation via batchIndexAbort AbortController.
   */
  ipcMain.handle('ai:indexAllNotes', async (event: IpcMainInvokeEvent, spaceId: string) => {
    try {
      // Ensure AIManager is initialized (required for embedding generation)
      const manager = getAIManager()
      if (!manager.isInitialized()) {
        await manager.initialize()
      }

      // Check if embedding model is available
      const service = getEmbeddingService()
      const modelId = service.getEmbeddingModel()
      const dl = await getDownloader()
      const isDownloaded = await dl.isModelDownloaded(modelId)

      if (!isDownloaded) {
        throw new Error(
          `The embedding model "${modelId}" is not downloaded. Download it before indexing notes.`
        )
      }

      const vectorDB = getOrCreateVectorDB(spaceId, getOrCreateFsManager)
      if (!vectorDB.isInitialized()) {
        await vectorDB.initialize()
      }

      const fsManager = getOrCreateFsManager(spaceId)

      // Set up abort controller for this batch
      batchIndexAbort = new AbortController()
      const { signal } = batchIndexAbort

      // Collect all notes recursively from folder tree
      const allNotes: Array<{ note: Note; folderId: string }> = []
      await collectNotesRecursively(fsManager, 'root', allNotes)

      const totalNotes = allNotes.length

      // ================================================================
      // PHASE 1: Check staleness — extract text + hash check each note
      // ================================================================

      const staleNotes: Array<{ note: Note; folderId: string; textContent: string }> = []

      for (let i = 0; i < allNotes.length; i++) {
        if (signal.aborted) break

        const { note, folderId } = allNotes[i]

        safeSend(event.sender, 'ai:indexing-progress', {
          current: i,
          total: totalNotes,
          noteId: note.id,
          noteTitle: note.title,
          status: 'checking'
        })

        try {
          const textContent = extractTextFromLexicalContent(note.content)
          if (textContent.trim()) {
            // Include folder path + contextual flag in hash (must match indexNote)
            const folderPath = await fsManager.getFullFolderPath(folderId).catch(() => undefined)
            const hashInput = EmbeddingService.buildStaleHashInput(textContent, folderPath)
            if (vectorDB.isNoteStale(note.id, hashInput)) {
              staleNotes.push({ note, folderId, textContent })
            }
          }
        } catch (error) {
          console.error(`[ai:indexAllNotes] Failed to check note ${note.id}:`, error)
        }
      }

      if (signal.aborted) {
        batchIndexAbort = null
        return {
          success: false,
          totalNotes,
          indexedNotes: 0,
          skippedNotes: totalNotes,
          erroredNotes: 0,
          cancelled: true
        }
      }

      // ================================================================
      // PHASE 2: Index only stale notes
      // ================================================================

      const staleCount = staleNotes.length
      let indexedNotes = 0
      let erroredNotes = 0

      // Cache full folder paths to avoid redundant reads during batch indexing
      const folderPathCache = new Map<string, string | undefined>()
      const getFullFolderPathCached = async (fid: string): Promise<string | undefined> => {
        if (folderPathCache.has(fid)) return folderPathCache.get(fid)
        try {
          const path = await fsManager.getFullFolderPath(fid)
          folderPathCache.set(fid, path)
          return path
        } catch {
          folderPathCache.set(fid, undefined)
          return undefined
        }
      }

      for (let i = 0; i < staleNotes.length; i++) {
        if (signal.aborted) break

        const { note, folderId, textContent } = staleNotes[i]

        safeSend(event.sender, 'ai:indexing-progress', {
          current: i,
          total: staleCount,
          noteId: note.id,
          noteTitle: note.title,
          status: 'indexing',
          staleCount
        })

        try {
          const folderPath = await getFullFolderPathCached(folderId)
          const wasIndexed = await service.indexNote(
            {
              id: note.id,
              folderId,
              folderPath,
              content: textContent,
              title: note.title,
              createdAt: note.createdAt,
              updatedAt: note.updatedAt
            },
            vectorDB
          )

          if (wasIndexed) {
            indexedNotes++
          }
        } catch (error) {
          console.error(`[ai:indexAllNotes] Failed to index note ${note.id}:`, error)
          erroredNotes++
        }
      }

      const cancelled = signal.aborted
      batchIndexAbort = null

      // Send completion event
      safeSend(event.sender, 'ai:indexing-progress', {
        current: cancelled ? indexedNotes : staleCount,
        total: staleCount,
        noteId: null,
        noteTitle: null,
        status: 'complete',
        staleCount
      })

      return {
        success: !cancelled,
        totalNotes,
        indexedNotes,
        skippedNotes: totalNotes - staleCount + (staleCount - indexedNotes - erroredNotes),
        erroredNotes,
        cancelled
      }
    } catch (error) {
      batchIndexAbort = null
      throw new Error(`Failed to index all notes: ${(error as Error).message}`)
    }
  })

  /**
   * Search notes using hybrid search (vector KNN + BM25 with RRF),
   * optional query expansion for improved recall,
   * and optional cross-encoder reranking for improved precision.
   *
   * Pipeline: Query → [Expand] → Multi-query Hybrid Search → RRF Merge → [Rerank] → Results
   */
  ipcMain.handle(
    'ai:searchNotes',
    async (
      _event: IpcMainInvokeEvent,
      spaceId: string,
      query: string,
      limit?: number,
      noteIds?: string[]
    ): Promise<ExpandedResult[]> => {
      try {
        return await runNoteSearch(getOrCreateFsManager, spaceId, query, { limit, noteIds })
      } catch (error) {
        console.error('[RAG] Search error:', error)
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

  /**
   * Get embedding model status for RAG operations
   * Returns whether the default embedding model is downloaded and available
   */
  ipcMain.handle('ai:getEmbeddingModelStatus', async (_event: IpcMainInvokeEvent) => {
    try {
      const service = getEmbeddingService()
      const modelId = service.getEmbeddingModel()
      const modelDef = ModelRegistry.getModel(modelId)

      if (!modelDef) {
        return {
          isAvailable: false,
          modelId,
          modelName: modelId,
          error: 'Embedding model not found in registry'
        }
      }

      const dl = await getDownloader()
      const isDownloaded = await dl.isModelDownloaded(modelId)

      return {
        isAvailable: isDownloaded,
        modelId,
        modelName: modelDef.name,
        sizeBytes: modelDef.sizeBytes,
        downloadUrl: modelDef.downloadUrl
      }
    } catch (error) {
      return {
        isAvailable: false,
        modelId: 'embeddinggemma-300m-q8',
        modelName: 'EmbeddingGemma 300M',
        error: (error as Error).message
      }
    }
  })

  /**
   * Get the current status of the background indexing queue
   */
  ipcMain.handle('ai:getIndexingQueueStatus', (_event: IpcMainInvokeEvent) => {
    if (!indexingQueue) {
      return {
        enabled: false,
        pending: 0,
        debouncing: 0,
        processing: false
      }
    }
    return {
      enabled: indexingQueue.isEmbeddingAvailable(),
      pending: indexingQueue.pendingCount,
      debouncing: indexingQueue.debouncingCount,
      processing: indexingQueue.processing
    }
  })

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
  ipcMain.handle('ai:listConversations', async (_event: IpcMainInvokeEvent) => {
    try {
      const convManager = getConversationManager()
      if (!convManager.isInitialized()) {
        await convManager.initialize()
      }
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
