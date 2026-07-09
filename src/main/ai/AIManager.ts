/**
 * AI Manager - Core Orchestrator (Singleton)
 *
 * Central component that orchestrates all AI operations including:
 * - LLM initialization with optimal GPU backend
 * - Model loading/unloading with memory management
 * - GPU layer optimization based on available VRAM
 *
 * Reference: docs/AI_ARCHITECTURE.md section 6.1
 */

// Use type-only imports for node-llama-cpp (erased at compile time)
// The actual module is loaded dynamically in initialize() to avoid ESM/CJS issues
import type {
  Llama,
  LlamaModel,
  LlamaContext,
  LlamaEmbeddingContext,
  LlamaRankingContext,
  LlamaChatSession,
  LlamaContextSequence,
  ChatHistoryItem,
  LlamaChatResponseChunk
} from 'node-llama-cpp'
import { app } from 'electron'
import { join } from 'path'
import { HardwareDetector } from './HardwareDetector'
import { ModelRegistry } from './ModelRegistry'
import { GGUF_CHAT_ID, resolveChatId, supportsMlx } from './ModelSelector'
import { MlxLlmBackend } from './llm/MlxLlmBackend'
import type { LlmToolCall } from './llm/LlmSidecarManager'
import type { HardwareInfo, ModelDefinition, LoadedModel, ExpandedResult } from './types'
import { AINotInitializedError, ModelNotFoundError, ModelLoadError } from './errors'

/**
 * Shared `searchNotes` tool contract offered to the model for on-demand RAG.
 * Used by both the node-llama-cpp path (defineChatSessionFunction) and the MLX
 * path (OpenAI-style function tool passed to the sidecar's chat template).
 */
const SEARCH_NOTES_DESCRIPTION =
  "Search the user's personal notes and knowledge base for information needed to answer. " +
  'Call this ONLY when the answer depends on the user’s own notes, meetings or documents. ' +
  'Answer directly, without calling this, for general questions or when the conversation already ' +
  'contains the needed context.'

const SEARCH_NOTES_PARAMS = {
  type: 'object' as const,
  properties: {
    query: {
      type: 'string' as const,
      description: 'A concise, focused search query describing what to look for in the notes'
    }
  }
}

/**
 * Chat message format for conversation input
 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

/**
 * Options for text generation
 */
export interface GenerationOptions {
  maxTokens?: number
  temperature?: number
  topP?: number
  repeatPenalty?: number
  stopSequences?: string[]
  isolated?: boolean
  /** Override context size for isolated sessions (default 512). Capped at model's trainContextSize. */
  contextSize?: number
  /**
   * Cap on reasoning/thought tokens for reasoning models (e.g. Qwen3.5).
   * Set to 0 to disable thinking entirely so the full `maxTokens` budget goes to
   * the actual response. When omitted, node-llama-cpp's default budget applies.
   */
  thoughtTokens?: number
  /**
   * RAG retrieval context. When present (and passed through IPC), the chat
   * handler builds a `ChatRetrievalTool` from it and offers the model a
   * `searchNotes` tool so it can retrieve notes on demand instead of having
   * the context injected into every prompt. This field carries only plain,
   * IPC-serializable data — the actual retrieval function is built in the main
   * process and passed to `generateChatCompletion` as a separate argument.
   */
  rag?: {
    spaceId: string
    limit?: number
    noteIds?: string[]
  }
}

/**
 * On-demand note retrieval for tool-based RAG.
 *
 * Built in the main process (it depends on per-space VectorDB/EmbeddingService)
 * and injected into `generateChatCompletion` as a non-serializable argument, so
 * `AIManager` stays decoupled from spaces and the vector DB layer.
 */
export interface ChatRetrievalTool {
  /** Run the hybrid search pipeline for a query and return ranked results. */
  search: (query: string) => Promise<ExpandedResult[]>
  /** When false, the model may search at most once per message. Default: true. */
  multiSearch?: boolean
}

/**
 * Result returned from chat completion
 */
export interface ChatCompletionResult {
  response: string
  tokensUsed: number
  aborted?: boolean
}

// Type for the dynamically imported node-llama-cpp module
type NodeLlamaCpp = typeof import('node-llama-cpp')

/**
 * Configuration for the AI Manager
 */
export interface AIManagerConfig {
  modelsDir: string
  maxContextSize: number
  defaultGpuLayers: number | 'auto'
}

/**
 * Internal representation of a loaded model with llama.cpp references
 */
interface InternalLoadedModel {
  id: string
  model: LlamaModel
  context: LlamaContext | null
  contextSequence: LlamaContextSequence | null
  chatSession: LlamaChatSession | null
  embeddingContext: LlamaEmbeddingContext | null
  lastUsed: number
  memoryUsage: number
}

/**
 * AIManager singleton class
 *
 * Manages LLM lifecycle including initialization, model loading/unloading,
 * and memory management with automatic cleanup of idle models.
 */
export class AIManager {
  private static instance: AIManager | null = null

  // Dynamically imported node-llama-cpp module (loaded in initialize())
  private nodeLlamaCpp: NodeLlamaCpp | null = null
  private llama: Llama | null = null
  private loadedModels: Map<string, InternalLoadedModel> = new Map()
  private config: AIManagerConfig
  private hardwareInfo: HardwareInfo | null = null
  private initialized: boolean = false

  // MLX text-generation backend (Python sidecar). Instantiated on Apple Silicon
  // only; chat models with format 'mlx' are routed here instead of llama.cpp.
  private mlxBackend: MlxLlmBackend | null = null

  // Memory management constants
  private readonly MAX_LOADED_MODELS = 3
  private readonly IDLE_UNLOAD_TIMEOUT = 5 * 60 * 1000 // 5 minutes
  private cleanupInterval: NodeJS.Timeout | null = null
  private modelUnloadListeners: Array<(modelId: string) => void> = []

  private constructor() {
    this.config = {
      modelsDir: join(app.getPath('userData'), 'models'),
      // 8192 gives the reasoning model (Qwen3.5) headroom for its thought budget
      // plus the system prompt, function-call schema and tool results (retrieved
      // notes) without triggering a context-shift/compression failure. Still
      // modest for the 16GB mid-end target given the small 4B model.
      maxContextSize: 8192,
      defaultGpuLayers: 'auto'
    }
  }

  /**
   * Get singleton instance
   */
  static getInstance(): AIManager {
    if (!AIManager.instance) {
      AIManager.instance = new AIManager()
    }
    return AIManager.instance
  }

  /**
   * Initialize llama.cpp with detected GPU backend
   *
   * Detects system hardware and initializes llama.cpp with the optimal
   * GPU backend (CUDA, Metal, or Vulkan). Starts the idle model cleanup interval.
   *
   * @throws {Error} If initialization fails
   */
  async initialize(): Promise<{ gpuFallback: boolean }> {
    if (this.initialized) return { gpuFallback: false }

    // Dynamically import node-llama-cpp (ESM module with top-level await)
    // This must be done with dynamic import() to avoid CJS/ESM compatibility issues
    this.nodeLlamaCpp = await import('node-llama-cpp')

    // Detect hardware first
    const hardware = await HardwareDetector.detect()
    this.hardwareInfo = hardware

    // Determine optimal GPU backend using HardwareDetector
    const gpuBackend = HardwareDetector.getRecommendedGpuBackend(hardware)

    // Try GPU first; fall back to CPU if GPU initialization fails
    // (e.g. unsigned dylibs blocked by macOS Hardened Runtime in production builds)
    let gpuFallback = false
    if (gpuBackend !== false) {
      try {
        this.llama = await this.nodeLlamaCpp.getLlama({ gpu: gpuBackend })
      } catch (gpuError) {
        console.error(
          `[AIManager] GPU backend (${gpuBackend}) init failed, falling back to CPU:`,
          gpuError
        )
        this.llama = await this.nodeLlamaCpp.getLlama({ gpu: false })
        gpuFallback = true
      }
    } else {
      this.llama = await this.nodeLlamaCpp.getLlama({ gpu: false })
    }

    const ramGB = ((hardware.memory.totalBytes ?? 0) / (1024 * 1024 * 1024)).toFixed(1)
    const vramGB = hardware.gpu.vramBytes
      ? (hardware.gpu.vramBytes / (1024 * 1024 * 1024)).toFixed(1) + 'GB'
      : 'null (unified)'
    console.log(
      `[AIManager] GPU backend: ${gpuFallback ? 'cpu (fallback)' : gpuBackend || 'cpu'} | GPU: ${hardware.gpu.name} | VRAM: ${vramGB} | RAM: ${ramGB}GB`
    )

    // On Apple Silicon, route MLX chat models through the Python sidecar.
    if (supportsMlx(hardware)) {
      this.mlxBackend = new MlxLlmBackend()
      console.log('[AIManager] MLX LLM backend enabled (Apple Silicon)')
    }

    this.initialized = true

    // Start idle model cleanup interval (check every minute)
    this.cleanupInterval = setInterval(() => this.cleanupIdleModels(), 60000)

    return { gpuFallback }
  }

  /**
   * Load a model with automatic GPU layer optimization
   *
   * If the model is already loaded, updates lastUsed timestamp and returns it.
   * Enforces MAX_LOADED_MODELS limit by unloading least recently used models.
   *
   * @param modelId - The ID of the model to load (from ModelRegistry)
   * @returns Information about the loaded model
   * @throws {AINotInitializedError} If AIManager is not initialized
   * @throws {ModelNotFoundError} If the model is not in the registry
   * @throws {ModelLoadError} If loading the model fails
   */
  async loadModel(modelId: string): Promise<{ id: string; lastUsed: number; memoryUsage: number }> {
    // MLX chat models load via the Python sidecar, not llama.cpp.
    const routedDef = ModelRegistry.getModel(modelId)
    if (routedDef?.format === 'mlx') {
      if (!this.mlxBackend) {
        throw new ModelLoadError(modelId, 'MLX backend unavailable on this platform')
      }
      return this.mlxBackend.load(modelId)
    }

    if (!this.llama) {
      throw new AINotInitializedError()
    }

    // Return cached if already loaded
    const existing = this.loadedModels.get(modelId)
    if (existing) {
      existing.lastUsed = Date.now()
      return {
        id: existing.id,
        lastUsed: existing.lastUsed,
        memoryUsage: existing.memoryUsage
      }
    }

    // Enforce max loaded models limit
    if (this.loadedModels.size >= this.MAX_LOADED_MODELS) {
      await this.unloadLeastRecentlyUsed()
    }

    // Get model definition from registry
    const modelDef = ModelRegistry.getModel(modelId)
    if (!modelDef) {
      throw new ModelNotFoundError(modelId)
    }

    const modelPath = join(this.config.modelsDir, modelDef.filename)

    // Calculate optimal GPU layers based on available VRAM (or unified memory on Apple Silicon)
    const gpuLayers = this.calculateOptimalGpuLayers(modelDef)
    console.log(`[AIManager] Loading ${modelId} with ${gpuLayers}/${modelDef.layers} GPU layers`)

    try {
      // Load the model with optimized settings
      const model = await this.llama.loadModel({
        modelPath,
        gpuLayers,
        defaultContextFlashAttention: true
      })

      const loadedModel: InternalLoadedModel = {
        id: modelId,
        model,
        context: null,
        contextSequence: null,
        chatSession: null,
        embeddingContext: null,
        lastUsed: Date.now(),
        memoryUsage: modelDef.sizeBytes
      }

      this.loadedModels.set(modelId, loadedModel)

      return {
        id: loadedModel.id,
        lastUsed: loadedModel.lastUsed,
        memoryUsage: loadedModel.memoryUsage
      }
    } catch (error) {
      throw new ModelLoadError(modelId, error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * Unload a specific model and free memory
   *
   * Disposes of all contexts and the model itself, then removes from cache.
   *
   * @param modelId - The ID of the model to unload
   */
  async unloadModel(modelId: string): Promise<void> {
    // MLX chat models are owned by the sidecar backend.
    if (ModelRegistry.getModel(modelId)?.format === 'mlx') {
      if (this.mlxBackend?.isLoaded(modelId)) await this.mlxBackend.unload()
      for (const listener of this.modelUnloadListeners) listener(modelId)
      return
    }

    const loaded = this.loadedModels.get(modelId)
    if (!loaded) return

    // Dispose contexts first (must be done before model disposal)
    // Chat session doesn't need explicit disposal - it's tied to the context sequence
    loaded.chatSession = null

    if (loaded.contextSequence) {
      loaded.contextSequence.dispose()
      loaded.contextSequence = null
    }
    if (loaded.embeddingContext) {
      await loaded.embeddingContext.dispose()
    }
    if (loaded.context) {
      await loaded.context.dispose()
    }

    // Dispose model
    await loaded.model.dispose()

    this.loadedModels.delete(modelId)

    // Notify listeners
    for (const listener of this.modelUnloadListeners) {
      listener(modelId)
    }
  }

  /**
   * Get list of currently loaded models with metadata
   */
  getLoadedModels(): LoadedModel[] {
    const llama = Array.from(this.loadedModels.values()).map((model) => ({
      id: model.id,
      lastUsed: model.lastUsed,
      memoryUsage: model.memoryUsage
    }))
    return [...llama, ...(this.mlxBackend?.getLoadedModels() ?? [])]
  }

  /**
   * Check if manager is initialized
   */
  isInitialized(): boolean {
    return this.initialized
  }

  /**
   * Register a listener for model unload events
   *
   * Called whenever a model is unloaded (explicit, idle cleanup, or LRU eviction).
   * Useful for invalidating cached contexts that reference the unloaded model.
   *
   * @param listener - Callback receiving the unloaded model's ID
   */
  onModelUnload(listener: (modelId: string) => void): void {
    this.modelUnloadListeners.push(listener)
  }

  /**
   * Get current hardware info
   */
  getHardwareInfo(): HardwareInfo | null {
    return this.hardwareInfo
  }

  /**
   * Resolve the default chat/summary model id for this machine (MLX on Apple
   * Silicon, GGUF elsewhere). Single source of truth for chat-model consumers
   * outside the AI subsystem (AudioManager summaries, EmbeddingService context).
   */
  getDefaultChatModelId(): string {
    return this.hardwareInfo ? resolveChatId(this.hardwareInfo) : GGUF_CHAT_ID
  }

  /**
   * Get current configuration
   */
  getConfig(): AIManagerConfig {
    return { ...this.config }
  }

  /**
   * Get memory management limits
   */
  getLimits(): { maxModels: number; idleTimeout: number } {
    return {
      maxModels: this.MAX_LOADED_MODELS,
      idleTimeout: this.IDLE_UNLOAD_TIMEOUT
    }
  }

  /**
   * Cleanup and dispose all resources
   *
   * Unloads all models, clears the cleanup interval, and resets state.
   * Should be called on app quit.
   */
  async dispose(): Promise<void> {
    // Clear cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }

    // Unload all models — isolate failures so one bad unload doesn't block shutdown
    const modelIds = Array.from(this.loadedModels.keys())
    for (const id of modelIds) {
      try {
        await this.unloadModel(id)
      } catch (error) {
        console.error(`[AIManager] Failed to unload ${id} during dispose:`, error)
      }
    }

    // Dispose the MLX sidecar (frees the Python process + model).
    if (this.mlxBackend) {
      try {
        await this.mlxBackend.dispose()
      } catch (error) {
        console.error('[AIManager] Failed to dispose MLX backend during dispose:', error)
      }
      this.mlxBackend = null
    }

    this.initialized = false
    this.llama = null
    this.nodeLlamaCpp = null
    this.hardwareInfo = null
  }

  /**
   * Get or create chat context for a model
   *
   * Creates both the LlamaContext and a LlamaContextSequence for chat operations.
   * The context sequence is reused for continuing conversations.
   *
   * @param modelId - The model ID
   * @param contextSize - Optional context size override
   * @returns The LlamaContext instance
   */
  async getChatContext(modelId: string, contextSize?: number): Promise<LlamaContext> {
    const loaded = this.loadedModels.get(modelId)
    if (!loaded) {
      // Load the model first
      await this.loadModel(modelId)
      return this.getChatContext(modelId, contextSize)
    }

    // Update last used
    loaded.lastUsed = Date.now()

    if (!loaded.context) {
      loaded.context = await loaded.model.createContext({
        contextSize: contextSize || this.config.maxContextSize
      })
      // Create a context sequence for chat operations
      loaded.contextSequence = loaded.context.getSequence()
      this.disableSequenceCheckpoints(loaded.contextSequence)
    }

    return loaded.context
  }

  /**
   * Get or create embedding context for a model
   *
   * Used internally for embedding generation.
   *
   * @param modelId - The model ID
   * @returns The LlamaEmbeddingContext instance
   */
  async getEmbeddingContext(modelId: string): Promise<LlamaEmbeddingContext> {
    const loaded = this.loadedModels.get(modelId)
    if (!loaded) {
      // Load the model first
      await this.loadModel(modelId)
      return this.getEmbeddingContext(modelId)
    }

    // Update last used
    loaded.lastUsed = Date.now()

    if (!loaded.embeddingContext) {
      loaded.embeddingContext = await loaded.model.createEmbeddingContext()
    }

    return loaded.embeddingContext
  }

  /**
   * Create a ranking context for a reranker model
   *
   * Used for cross-encoder reranking of search results.
   * The ranking context is not cached on the loaded model — callers
   * should manage their own reference and dispose when done.
   *
   * @param modelId - The reranker model ID
   * @returns The LlamaRankingContext instance
   */
  async createRankingContext(modelId: string): Promise<LlamaRankingContext> {
    const loaded = this.loadedModels.get(modelId)
    if (!loaded) {
      await this.loadModel(modelId)
      return this.createRankingContext(modelId)
    }

    loaded.lastUsed = Date.now()
    return loaded.model.createRankingContext()
  }

  /**
   * Generate chat completion with streaming support
   *
   * Loads the model if not already loaded, creates a chat session,
   * and streams the response using an AsyncGenerator.
   *
   * @param modelId - The ID of the model to use
   * @param messages - Array of chat messages (user, assistant, system)
   * @param options - Optional generation parameters
   * @yields String chunks of the generated response
   * @returns ChatCompletionResult with full response and token count
   * @throws {AINotInitializedError} If AIManager is not initialized
   * @throws {ModelNotFoundError} If the model is not in the registry
   */
  async *generateChatCompletion(
    modelId: string,
    messages: ChatMessage[],
    options?: GenerationOptions,
    signal?: AbortSignal,
    retrieval?: ChatRetrievalTool,
    onThought?: (delta: string, full: string) => void
  ): AsyncGenerator<string, ChatCompletionResult> {
    // Route MLX chat models to the Python sidecar backend.
    if (ModelRegistry.getModel(modelId)?.format === 'mlx') {
      return yield* this.generateChatCompletionMlx(
        modelId,
        messages,
        options,
        signal,
        retrieval,
        onThought
      )
    }

    if (!this.nodeLlamaCpp) {
      throw new AINotInitializedError()
    }

    // Ensure model is loaded and get context
    const context = await this.getChatContext(modelId)
    const loaded = this.loadedModels.get(modelId)!

    // Update last used timestamp
    loaded.lastUsed = Date.now()

    // Create or select the chat session
    let session: InstanceType<typeof this.nodeLlamaCpp.LlamaChatSession>
    let tempContext: Awaited<ReturnType<typeof loaded.model.createContext>> | null = null

    // Extract system prompt from messages — needed for both isolated and persistent sessions
    const systemMessage = messages.find((m) => m.role === 'system')

    if (options?.isolated) {
      // Create a temporary, isolated context and session for one-off completions (e.g. title generation)
      // This avoids polluting the main chat session's history
      const requestedSize = options.contextSize ?? 512
      const modelMax = loaded.model.trainContextSize ?? this.config.maxContextSize
      const isolatedContextSize = Math.min(requestedSize, modelMax)
      tempContext = await loaded.model.createContext({ contextSize: isolatedContextSize })
      const tempSequence = tempContext.getSequence()
      this.disableSequenceCheckpoints(tempSequence)
      session = new this.nodeLlamaCpp.LlamaChatSession({
        contextSequence: tempSequence,
        systemPrompt: systemMessage?.content
      })
    } else {
      // Reuse or create the persistent chat session
      if (!loaded.chatSession && loaded.contextSequence) {
        loaded.chatSession = new this.nodeLlamaCpp.LlamaChatSession({
          contextSequence: loaded.contextSequence,
          systemPrompt: systemMessage?.content
        })
      }

      if (!loaded.chatSession) {
        throw new Error(`Failed to create chat session for model ${modelId}`)
      }
      session = loaded.chatSession
    }

    // The renderer sends the FULL conversation on every call (the model is used
    // statelessly). Replace the session's chat history with exactly these prior
    // turns before prompting — otherwise the persistent session keeps the KV
    // cache of a previous conversation and leaks it across chats/spaces.
    const priorMessages = messages.slice(0, -1)
    const lastMessage = messages[messages.length - 1]
    const lastUserText = lastMessage?.role === 'user' ? lastMessage.content : ''
    session.setChatHistory(this.buildChatHistoryItems(priorMessages))

    // Set up real-time streaming with async queue pattern
    let fullResponse = ''
    let fullThought = ''
    let resolveChunk: ((value: string | null) => void) | null = null
    let done = false
    const chunkQueue: string[] = []
    let generationError: Error | null = null

    // Internal abort controller so native generation is ALWAYS stopped when this
    // generator finishes for any reason — including early abandonment (consumer
    // `break`/`return` or an upstream throw) that would otherwise leave
    // session.prompt() running on the GPU and the isolated context undisposed.
    // Linked to the caller's signal so external cancellation still propagates.
    const abortController = new AbortController()
    const onExternalAbort = (): void => abortController.abort()
    if (signal) {
      if (signal.aborted) abortController.abort()
      else signal.addEventListener('abort', onExternalAbort, { once: true })
    }

    // Build the on-demand RAG tool when a retrieval callback was provided. The
    // model decides whether/when to call it, so relevant notes only enter the
    // context when actually needed instead of being injected into every prompt.
    const functions = retrieval
      ? { searchNotes: this.buildSearchNotesFunction(retrieval) }
      : undefined

    // Cap the reasoning budget for interactive chat. node-llama-cpp otherwise
    // defaults to 75% of the context (50% below 8192 tokens), which on a
    // reasoning model like Qwen3.5 both slows first-token latency and can crowd
    // out the system prompt + tool result. Isolated one-off calls keep the
    // caller-provided budget (or the default) untouched.
    const thoughtBudget =
      options?.thoughtTokens !== undefined
        ? options.thoughtTokens
        : options?.isolated
          ? undefined
          : 1536

    // Start generation without awaiting - this allows chunks to be yielded in real-time
    const generationPromise = session
      .prompt(lastUserText, {
        maxTokens: options?.maxTokens ?? 2048,
        temperature: options?.temperature ?? 0.7,
        topP: options?.topP,
        repeatPenalty: options?.repeatPenalty ? { penalty: options.repeatPenalty } : undefined,
        budgets: thoughtBudget !== undefined ? { thoughtTokens: thoughtBudget } : undefined,
        functions,
        stopOnAbortSignal: true,
        signal: abortController.signal,
        // Use onResponseChunk (segment-aware) so reasoning "thought" segments can
        // be surfaced separately from the main answer. Main-response chunks
        // (type === undefined) drive the yielded stream exactly like onTextChunk
        // did; thought chunks are forwarded to the optional onThought callback.
        onResponseChunk: (responseChunk: LlamaChatResponseChunk) => {
          if (responseChunk.type === undefined) {
            const chunk = responseChunk.text
            if (!chunk) return
            fullResponse += chunk
            // If there's a waiting consumer, resolve immediately
            if (resolveChunk) {
              resolveChunk(chunk)
              resolveChunk = null
            } else {
              // Otherwise queue the chunk for later consumption
              chunkQueue.push(chunk)
            }
          } else if (responseChunk.segmentType === 'thought' && responseChunk.text) {
            fullThought += responseChunk.text
            onThought?.(responseChunk.text, fullThought)
          }
        }
      })
      .then(() => {
        done = true
        // Signal completion to any waiting consumer
        if (resolveChunk) {
          resolveChunk(null)
          resolveChunk = null
        }
      })
      .catch((error: Error) => {
        generationError = error
        done = true
        // Signal error to any waiting consumer
        if (resolveChunk) {
          resolveChunk(null)
          resolveChunk = null
        }
      })

    try {
      // Yield chunks as they arrive in real-time
      while (!done || chunkQueue.length > 0) {
        // If there are queued chunks, yield them immediately
        if (chunkQueue.length > 0) {
          yield chunkQueue.shift()!
        } else if (!done) {
          // Wait for the next chunk to arrive
          const chunk = await new Promise<string | null>((resolve) => {
            resolveChunk = resolve
          })
          if (chunk !== null) {
            yield chunk
          }
        }
      }

      // Wait for generation to fully complete and handle any errors
      await generationPromise

      if (generationError) {
        throw generationError
      }

      // Diagnostic: reveals whether the model emitted reasoning ("thought")
      // segments this turn — useful to explain why the thinking panel may not
      // appear (no thought chars = the model didn't reason as a segment).
      console.log(
        `[AIManager] chat generated: thought=${fullThought.length} chars, response=${fullResponse.length} chars`
      )

      // Return final result with complete response and token usage
      return {
        response: fullResponse,
        tokensUsed: context.contextSize // Approximation - actual usage from metadata if available
      }
    } finally {
      // Stop native generation if we exited early (abandoned generator) and
      // detach the external-signal listener.
      abortController.abort()
      if (signal) signal.removeEventListener('abort', onExternalAbort)
      // Let the detached generation settle before disposing its context, so
      // llama.cpp is not still writing into a context we are freeing.
      await generationPromise.catch(() => {})
      // Dispose temporary context for isolated sessions — on every exit path.
      if (tempContext) {
        await tempContext.dispose()
      }
    }
  }

  /**
   * MLX variant of generateChatCompletion — streams through the Python sidecar.
   *
   * Mirrors the llama.cpp contract (yields response chunks, forwards reasoning
   * to `onThought`, returns ChatCompletionResult) but implements on-demand RAG
   * as a main-side agent loop: the first turn offers the `searchNotes` tool; if
   * the model calls it, the notes are retrieved and a second, tool-free turn
   * answers using them (template-agnostic, avoids relying on multi-turn tool
   * message rendering).
   */
  private async *generateChatCompletionMlx(
    modelId: string,
    messages: ChatMessage[],
    options?: GenerationOptions,
    signal?: AbortSignal,
    retrieval?: ChatRetrievalTool,
    onThought?: (delta: string, full: string) => void
  ): AsyncGenerator<string, ChatCompletionResult> {
    if (!this.mlxBackend) throw new AINotInitializedError()

    const abortController = new AbortController()
    const onExternalAbort = (): void => abortController.abort()
    if (signal) {
      if (signal.aborted) abortController.abort()
      else signal.addEventListener('abort', onExternalAbort, { once: true })
    }

    // thoughtTokens === 0 disables reasoning (summaries); isolated one-off tasks
    // (titles, query expansion, contextualization) also skip reasoning so their
    // tiny token budgets go to the actual output. Interactive chat reasons.
    const enableThinking = options?.thoughtTokens === 0 ? false : !options?.isolated
    const baseMax = options?.maxTokens ?? 2048
    // mlx-lm's max_tokens caps the WHOLE generation (reasoning + answer), unlike
    // node-llama-cpp's separate thought budget — give reasoning turns headroom.
    const maxTokens = baseMax + (enableThinking ? 1536 : 0)
    const temperature = options?.temperature ?? 0.7
    const topP = options?.topP
    const repetitionPenalty = options?.repeatPenalty

    const convo: Array<Record<string, unknown>> = messages.map((m) => ({
      role: m.role,
      content: m.content
    }))

    let fullResponse = ''
    let fullThought = ''
    let generationTokens = 0

    const streamTurn = async function* (
      this: AIManager,
      turnMessages: Array<Record<string, unknown>>,
      tools: unknown[] | undefined
    ): AsyncGenerator<string, LlmToolCall[]> {
      const gen = this.mlxBackend!.generateStream(
        modelId,
        {
          messages: turnMessages,
          tools,
          maxTokens,
          temperature,
          topP,
          repetitionPenalty,
          enableThinking
        },
        abortController.signal
      )
      let next = await gen.next()
      while (!next.done) {
        const chunk = next.value
        if (chunk.channel === 'thought') {
          fullThought += chunk.text
          onThought?.(chunk.text, fullThought)
        } else {
          fullResponse += chunk.text
          yield chunk.text
        }
        next = await gen.next()
      }
      generationTokens += next.value.generationTokens
      return next.value.toolCalls
    }

    try {
      const tools = retrieval ? [this.buildSearchNotesToolSchema()] : undefined
      const toolCalls = yield* streamTurn.call(this, convo, tools)

      // The model requested a note search and produced no direct answer yet →
      // retrieve, inject as context, and answer in a second tool-free turn.
      // Use trim(): a reasoning turn leaks a newline or two into the response
      // channel before the tool call, which must not block retrieval.
      if (retrieval && toolCalls.length > 0 && fullResponse.trim().length === 0) {
        const blocks: string[] = []
        for (const call of toolCalls) {
          const query = call.arguments?.query
          if (typeof query !== 'string' || query.length === 0) continue
          try {
            blocks.push(this.formatNotesForModel(await retrieval.search(query)))
          } catch (error) {
            blocks.push(`Note search failed: ${(error as Error).message}.`)
          }
          if (retrieval.multiSearch === false) break
        }

        const notesInstruction =
          "\n\n# Retrieved notes\nUse these notes from the user's knowledge base to answer their " +
          "last message. If they don't contain the answer, say so.\n\n" +
          blocks.join('\n\n')
        const answerConvo = convo.map((m) => ({ ...m }))
        const sysIdx = answerConvo.findIndex((m) => m.role === 'system')
        if (sysIdx >= 0) {
          answerConvo[sysIdx].content = String(answerConvo[sysIdx].content ?? '') + notesInstruction
        } else {
          answerConvo.unshift({ role: 'system', content: notesInstruction.trim() })
        }
        yield* streamTurn.call(this, answerConvo, undefined)
      }

      console.log(
        `[AIManager] MLX chat generated: thought=${fullThought.length} chars, response=${fullResponse.length} chars`
      )
      return {
        response: fullResponse,
        tokensUsed: generationTokens,
        aborted: abortController.signal.aborted || undefined
      }
    } finally {
      abortController.abort()
      if (signal) signal.removeEventListener('abort', onExternalAbort)
    }
  }

  /** OpenAI-style function tool schema for the MLX sidecar's chat template. */
  private buildSearchNotesToolSchema(): Record<string, unknown> {
    return {
      type: 'function',
      function: {
        name: 'searchNotes',
        description: SEARCH_NOTES_DESCRIPTION,
        parameters: SEARCH_NOTES_PARAMS
      }
    }
  }

  /**
   * Count tokens for `text` under a model's tokenizer. Backend-agnostic: MLX
   * models go through the sidecar, GGUF models through the llama.cpp instance.
   * Used by the summary map-reduce to budget chunks.
   */
  async countTokens(modelId: string, text: string): Promise<number> {
    if (ModelRegistry.getModel(modelId)?.format === 'mlx') {
      if (!this.mlxBackend) throw new AINotInitializedError()
      return this.mlxBackend.countTokens(modelId, text)
    }
    const model = await this.getModelInstance(modelId)
    return model.tokenize(text).length
  }

  /**
   * Reset the chat session for a model
   *
   * Clears the conversation history, allowing a fresh start.
   *
   * @param modelId - The model ID to reset
   */
  async resetChatSession(modelId: string): Promise<void> {
    const loaded = this.loadedModels.get(modelId)
    if (!loaded) return

    // Dispose current context sequence and session
    loaded.chatSession = null

    if (loaded.contextSequence) {
      loaded.contextSequence.dispose()
      loaded.contextSequence = null
    }

    // Recreate context sequence if context exists
    if (loaded.context) {
      loaded.contextSequence = loaded.context.getSequence()
      this.disableSequenceCheckpoints(loaded.contextSequence)
    }
  }

  /**
   * Convert chat messages to llama.cpp chat history format
   *
   * @param messages - Array of ChatMessage objects
   * @returns Array of objects with role and text properties
   */
  /**
   * Convert our ChatMessage[] into node-llama-cpp ChatHistoryItem[] so the full
   * conversation can be set on the session before each prompt (stateless use).
   * This guarantees each generation reflects exactly the provided messages and
   * never inherits state from a previous conversation/space.
   */
  private buildChatHistoryItems(messages: ChatMessage[]): ChatHistoryItem[] {
    const items: ChatHistoryItem[] = []
    for (const msg of messages) {
      if (msg.role === 'system') {
        items.push({ type: 'system', text: msg.content })
      } else if (msg.role === 'user') {
        items.push({ type: 'user', text: msg.content })
      } else {
        items.push({ type: 'model', response: [msg.content] })
      }
    }
    return items
  }

  /**
   * Build the `searchNotes` chat-session function offered to the model for
   * on-demand RAG. The model calls it with a query; the handler runs the
   * injected retrieval pipeline and returns compact, formatted excerpts as the
   * function result (fed back to the model), rather than pre-injecting context.
   */
  private buildSearchNotesFunction(retrieval: ChatRetrievalTool) {
    if (!this.nodeLlamaCpp) throw new AINotInitializedError()
    let callCount = 0
    return this.nodeLlamaCpp.defineChatSessionFunction({
      description: SEARCH_NOTES_DESCRIPTION,
      params: SEARCH_NOTES_PARAMS,
      handler: async ({ query }: { query: string }): Promise<string> => {
        if (retrieval.multiSearch === false && callCount >= 1) {
          return 'A note search was already performed for this message. Answer using the notes already retrieved above.'
        }
        callCount++
        try {
          const results = await retrieval.search(query)
          return this.formatNotesForModel(results)
        } catch (error) {
          // Return text (not a throw) so generation can continue gracefully.
          return `Note search failed: ${(error as Error).message}. Answer from your own knowledge or say you don't know.`
        }
      }
    })
  }

  /**
   * Format ranked note results into compact text for the model to consume as a
   * function-call result. Kept terse to conserve the small (4096-token) context.
   */
  private formatNotesForModel(results: ExpandedResult[]): string {
    if (results.length === 0) {
      return 'No relevant notes were found. Tell the user you could not find anything relevant in their notes.'
    }
    // Cap the amount of retrieved text fed back to the model: even with an 8192
    // context, an unbounded tool result (many notes × expanded sections) can
    // crowd out the system prompt and the response budget. Keep the strongest
    // matches and trim each excerpt.
    const MAX_NOTES = 5
    const MAX_CHARS_PER_NOTE = 1200
    const blocks = results.slice(0, MAX_NOTES).map((r, i) => {
      const meta = r.metadata as Record<string, unknown>
      const folderPath = meta?.folderPath as string | undefined
      const noteTitle = (meta?.noteTitle as string | undefined) ?? 'Untitled'
      const header: string[] = [`[${i + 1}] "${noteTitle}"`]
      if (folderPath) header.push(`in ${folderPath}`)
      if (r.sectionHeader) header.push(`> ${r.sectionHeader}`)
      header.push(`(relevance ${r.relevancePercent}%)`)
      let body = r.expandedContent || r.content
      if (body.length > MAX_CHARS_PER_NOTE) body = `${body.slice(0, MAX_CHARS_PER_NOTE)}…`
      return `${header.join(' ')}\n${body}`
    })
    return `Retrieved notes (ordered by relevance):\n\n${blocks.join('\n\n---\n\n')}`
  }

  /**
   * Unload the least recently used model
   *
   * Called when MAX_LOADED_MODELS limit is reached.
   */
  private async unloadLeastRecentlyUsed(): Promise<void> {
    let oldest: InternalLoadedModel | null = null
    let oldestTime = Infinity

    for (const [, model] of this.loadedModels) {
      if (model.lastUsed < oldestTime) {
        oldestTime = model.lastUsed
        oldest = model
      }
    }

    if (oldest) {
      await this.unloadModel(oldest.id)
    }
  }

  /**
   * Cleanup idle models that haven't been used recently
   *
   * Called periodically by the cleanup interval.
   */
  private cleanupIdleModels(): void {
    const now = Date.now()
    for (const [id, model] of this.loadedModels) {
      if (now - model.lastUsed > this.IDLE_UNLOAD_TIMEOUT) {
        // Fire and forget - don't block cleanup
        this.unloadModel(id).catch((error) => {
          console.error(`Failed to unload idle model ${id}:`, error)
        })
      }
    }
    // MLX sidecar has its own loaded model — unload it on the same idle policy.
    this.mlxBackend?.cleanupIdle(this.IDLE_UNLOAD_TIMEOUT).catch((error) => {
      console.error('[AIManager] Failed to unload idle MLX model:', error)
    })
  }

  /**
   * Disable context sequence checkpoints for hybrid/recurrent models.
   *
   * Workaround for llama.cpp crash in state_seq_get_data when serializing
   * SSM state for hybrid architectures (e.g. Qwen3.5 Gated DeltaNet).
   * See: https://github.com/ggml-org/llama.cpp/issues/20176
   *
   * Trade-off: full prompt re-processing on each turn (already the expected
   * behavior for Qwen3.5, see https://github.com/ggml-org/llama.cpp/issues/20225)
   */
  private disableSequenceCheckpoints(sequence: LlamaContextSequence): void {
    Object.defineProperty(sequence, 'needsCheckpoints', { get: () => false })
  }

  /**
   * Calculate optimal GPU layers based on available VRAM or unified memory (Apple Silicon)
   *
   * On Apple Silicon, systeminformation reports vramBytes = null because memory is unified
   * (shared between CPU and GPU). In this case we use system RAM as a proxy for available
   * GPU memory, with a 60% safety margin (vs 80% for dedicated VRAM) to leave room for the OS.
   *
   * @param modelDef - The model definition with size and layer info
   * @returns Number of layers to offload to GPU (0 for CPU only)
   */
  private calculateOptimalGpuLayers(modelDef: ModelDefinition): number {
    const vram = this.hardwareInfo?.gpu.vramBytes

    // Unified memory: macOS without dedicated VRAM = always Apple Silicon (M1/M2/M3/M4/M5/...)
    // Do NOT rely on gpu.name which can be 'Unknown' when systeminformation fails to detect
    // the chip model (e.g. on M5, system_profiler may return no display controller info).
    // hasMetal is simply `process.platform === 'darwin'`, so the combination of
    // hasMetal + no dedicated VRAM is unambiguous: it is Apple Silicon unified memory.
    const isUnifiedMemory = !vram && this.hardwareInfo?.gpu.hasMetal === true

    // For Apple Silicon, fall back to system RAM as the unified memory proxy
    const effectiveVram =
      vram ?? (isUnifiedMemory ? (this.hardwareInfo?.memory.totalBytes ?? null) : null) ?? null

    if (!effectiveVram) {
      return 0
    }

    const modelSize = modelDef.sizeBytes
    const totalLayers = modelDef.layers

    // Estimate: each layer uses roughly modelSize / totalLayers
    const layerSize = modelSize / totalLayers

    // Use 60% of unified memory (Apple Silicon) or 80% of dedicated VRAM as safety margin
    const safetyMargin = isUnifiedMemory && !vram ? 0.6 : 0.8
    const maxLayersInVram = Math.floor((effectiveVram * safetyMargin) / layerSize)

    const result = Math.min(maxLayersInVram, totalLayers)
    const effectiveVramGB = (effectiveVram / 1024 ** 3).toFixed(1)
    console.log(
      `[AIManager] GPU layers calc: unified=${isUnifiedMemory} effectiveVram=${effectiveVramGB}GB` +
        ` layers=${result}/${totalLayers}`
    )

    // Return the minimum of calculated layers and total layers
    return result
  }

  /**
   * Get the LlamaModel instance for a model (loads if needed)
   *
   * Useful for accessing tokenization primitives (tokenize/detokenize)
   * without needing the full chat or embedding context.
   *
   * @param modelId - The model ID
   * @returns The LlamaModel instance
   */
  async getModelInstance(modelId: string): Promise<LlamaModel> {
    const loaded = this.loadedModels.get(modelId)
    if (!loaded) {
      await this.loadModel(modelId)
      return this.getModelInstance(modelId)
    }
    loaded.lastUsed = Date.now()
    return loaded.model
  }

  /**
   * Get internal loaded model (for advanced operations)
   *
   * @internal
   */
  getInternalModel(modelId: string): InternalLoadedModel | undefined {
    return this.loadedModels.get(modelId)
  }
}
