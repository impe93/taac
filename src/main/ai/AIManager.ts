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
  LlamaChatSession,
  LlamaContextSequence
} from 'node-llama-cpp'
import { app } from 'electron'
import { join } from 'path'
import { HardwareDetector } from './HardwareDetector'
import { ModelRegistry } from './ModelRegistry'
import type { HardwareInfo, ModelDefinition } from './types'
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
  stopSequences?: string[]
}

/**
 * Result returned from chat completion
 */
export interface ChatCompletionResult {
  response: string
  tokensUsed: number
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
  private readonly MAX_LOADED_MODELS = 2
  private readonly IDLE_UNLOAD_TIMEOUT = 5 * 60 * 1000 // 5 minutes
  private cleanupInterval: NodeJS.Timeout | null = null

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
  async initialize(): Promise<void> {
    if (this.initialized) return

    // Dynamically import node-llama-cpp (ESM module with top-level await)
    // This must be done with dynamic import() to avoid CJS/ESM compatibility issues
    this.nodeLlamaCpp = await import('node-llama-cpp')

    // Detect hardware first
    const hardware = await HardwareDetector.detect()
    this.hardwareInfo = hardware

    // Determine optimal GPU backend using HardwareDetector
    const gpuBackend = HardwareDetector.getRecommendedGpuBackend(hardware)

    // Initialize llama.cpp with detected backend
    this.llama = await this.nodeLlamaCpp.getLlama({
      gpu: gpuBackend
    })

    this.initialized = true

    // Start idle model cleanup interval (check every minute)
    this.cleanupInterval = setInterval(() => this.cleanupIdleModels(), 60000)
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

    // Calculate optimal GPU layers based on available VRAM
    const gpuLayers = this.calculateOptimalGpuLayers(modelDef)

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
  }

  /**
   * Get list of currently loaded model IDs
   */
  getLoadedModels(): string[] {
    return Array.from(this.loadedModels.keys())
  }

  /**
   * Check if manager is initialized
   */
  isInitialized(): boolean {
    return this.initialized
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
    options?: GenerationOptions
  ): AsyncGenerator<string, ChatCompletionResult> {
    if (!this.nodeLlamaCpp) {
      throw new AINotInitializedError()
    }

    // Ensure model is loaded and get context
    const context = await this.getChatContext(modelId)
    const loaded = this.loadedModels.get(modelId)!

    // Update last used timestamp
    loaded.lastUsed = Date.now()

    // Create or reuse chat session with the context sequence
    if (!loaded.chatSession && loaded.contextSequence) {
      loaded.chatSession = new this.nodeLlamaCpp.LlamaChatSession({
        contextSequence: loaded.contextSequence
      })
    }

    if (!loaded.chatSession) {
      throw new Error(`Failed to create chat session for model ${modelId}`)
    }

    // Convert messages to llama.cpp chat history format
    const chatHistory = this.convertToChatHistory(messages)

    // Set up response accumulator
    let fullResponse = ''
    const chunks: string[] = []

    // Generate response with streaming via onTextChunk callback
    const response = await loaded.chatSession.prompt(
      chatHistory.length > 0 ? chatHistory[chatHistory.length - 1].text : '',
      {
        maxTokens: options?.maxTokens ?? 2048,
        temperature: options?.temperature ?? 0.7,
        topP: options?.topP,
        stopOnAbortSignal: true,
        onTextChunk: (chunk: string) => {
          fullResponse += chunk
          chunks.push(chunk)
        }
      }
    )

    // Yield all accumulated chunks for streaming
    for (const chunk of chunks) {
      yield chunk
    }

    // Return final result with complete response and token usage
    return {
      response: fullResponse || response,
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
    }
  }

  /**
   * Convert chat messages to llama.cpp chat history format
   *
   * @param messages - Array of ChatMessage objects
   * @returns Array of objects with role and text properties
   */
  private convertToChatHistory(messages: ChatMessage[]): Array<{ role: string; text: string }> {
    return messages.map((msg) => ({
      role: msg.role,
      text: msg.content
    }))
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
   * Calculate optimal GPU layers based on available VRAM
   *
   * Uses 80% of available VRAM as safety margin to prevent OOM errors.
   *
   * @param modelDef - The model definition with size and layer info
   * @returns Number of layers to offload to GPU (0 for CPU only)
   */
  private calculateOptimalGpuLayers(modelDef: ModelDefinition): number {
    // CPU only if no VRAM info available
    if (!this.hardwareInfo?.gpu.vramBytes) {
      return 0
    }

    const availableVram = this.hardwareInfo.gpu.vramBytes
    const modelSize = modelDef.sizeBytes
    const totalLayers = modelDef.layers

    // Estimate: each layer uses roughly modelSize / totalLayers
    const layerSize = modelSize / totalLayers

    // Use 80% of VRAM as safety margin
    const maxLayersInVram = Math.floor((availableVram * 0.8) / layerSize)

    // Return the minimum of calculated layers and total layers
    return Math.min(maxLayersInVram, totalLayers)
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
