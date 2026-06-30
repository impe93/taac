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
  ChatHistoryItem
} from 'node-llama-cpp'
import { app } from 'electron'
import { join } from 'path'
import { HardwareDetector } from './HardwareDetector'
import { ModelRegistry } from './ModelRegistry'
import type { HardwareInfo, ModelDefinition, LoadedModel } from './types'
import { AINotInitializedError, ModelNotFoundError, ModelLoadError } from './errors'

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

  // Memory management constants
  private readonly MAX_LOADED_MODELS = 3
  private readonly IDLE_UNLOAD_TIMEOUT = 5 * 60 * 1000 // 5 minutes
  private cleanupInterval: NodeJS.Timeout | null = null
  private modelUnloadListeners: Array<(modelId: string) => void> = []

  private constructor() {
    this.config = {
      modelsDir: join(app.getPath('userData'), 'models'),
      maxContextSize: 4096,
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
    return Array.from(this.loadedModels.values()).map((model) => ({
      id: model.id,
      lastUsed: model.lastUsed,
      memoryUsage: model.memoryUsage
    }))
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

    // Unload all models
    const modelIds = Array.from(this.loadedModels.keys())
    for (const id of modelIds) {
      await this.unloadModel(id)
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
    signal?: AbortSignal
  ): AsyncGenerator<string, ChatCompletionResult> {
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
    let resolveChunk: ((value: string | null) => void) | null = null
    let done = false
    const chunkQueue: string[] = []
    let generationError: Error | null = null

    // Start generation without awaiting - this allows chunks to be yielded in real-time
    const generationPromise = session
      .prompt(lastUserText, {
        maxTokens: options?.maxTokens ?? 2048,
        temperature: options?.temperature ?? 0.7,
        topP: options?.topP,
        repeatPenalty: options?.repeatPenalty ? { penalty: options.repeatPenalty } : undefined,
        stopOnAbortSignal: true,
        signal,
        onTextChunk: (chunk: string) => {
          fullResponse += chunk
          // If there's a waiting consumer, resolve immediately
          if (resolveChunk) {
            resolveChunk(chunk)
            resolveChunk = null
          } else {
            // Otherwise queue the chunk for later consumption
            chunkQueue.push(chunk)
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

    // Dispose temporary context for isolated sessions
    if (tempContext) {
      await tempContext.dispose()
    }

    if (generationError) {
      throw generationError
    }

    // Return final result with complete response and token usage
    return {
      response: fullResponse,
      tokensUsed: context.contextSize // Approximation - actual usage from metadata if available
    }
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
