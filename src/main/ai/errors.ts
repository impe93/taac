/**
 * AI Module - Custom Error Classes
 *
 * Contains all custom error classes for the AI subsystem.
 * Reference: docs/AI_ARCHITECTURE.md section 12.1
 */

/**
 * Formats bytes into human-readable string (MB or GB)
 */
export function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024)
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  const mb = bytes / (1024 * 1024)
  return `${mb.toFixed(0)} MB`
}

/**
 * Base class for all AI-related errors
 */
export class AIError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly recoverable: boolean = true
  ) {
    super(message)
    this.name = 'AIError'
  }
}

/**
 * Thrown when AIManager is not initialized
 */
export class AINotInitializedError extends AIError {
  constructor() {
    super('AIManager not initialized. Call initialize() first.', 'AI_NOT_INITIALIZED', false)
    this.name = 'AINotInitializedError'
  }
}

/**
 * Thrown when a requested model is not found in the registry
 */
export class ModelNotFoundError extends AIError {
  constructor(modelId: string) {
    super(`Model not found: ${modelId}`, 'MODEL_NOT_FOUND')
    this.name = 'ModelNotFoundError'
  }
}

/**
 * Thrown when a model file is not downloaded locally
 */
export class ModelNotDownloadedError extends AIError {
  constructor(modelId: string) {
    super(`Model not downloaded: ${modelId}. Please download it first.`, 'MODEL_NOT_DOWNLOADED')
    this.name = 'ModelNotDownloadedError'
  }
}

/**
 * Thrown when there isn't enough memory to load a model
 */
export class InsufficientMemoryError extends AIError {
  constructor(required: number, available: number) {
    super(
      `Insufficient memory: need ${formatBytes(required)}, have ${formatBytes(available)}`,
      'INSUFFICIENT_MEMORY',
      false
    )
    this.name = 'InsufficientMemoryError'
  }
}

/**
 * Thrown when GPU is required but not available
 */
export class GPUNotAvailableError extends AIError {
  constructor() {
    super('No compatible GPU found. The model will run on CPU (slower).', 'GPU_NOT_AVAILABLE', true)
    this.name = 'GPUNotAvailableError'
  }
}

/**
 * Thrown when requested context size exceeds model's maximum
 */
export class ContextSizeExceededError extends AIError {
  constructor(requested: number, max: number) {
    super(`Context size ${requested} exceeds maximum ${max}`, 'CONTEXT_SIZE_EXCEEDED')
    this.name = 'ContextSizeExceededError'
  }
}

/**
 * Thrown when model download fails
 */
export class DownloadFailedError extends AIError {
  constructor(modelId: string, reason: string) {
    super(`Failed to download model ${modelId}: ${reason}`, 'DOWNLOAD_FAILED')
    this.name = 'DownloadFailedError'
  }
}

/**
 * Thrown when embedding generation fails
 */
export class EmbeddingFailedError extends AIError {
  constructor(noteId: string, reason: string) {
    super(`Failed to generate embeddings for note ${noteId}: ${reason}`, 'EMBEDDING_FAILED')
    this.name = 'EmbeddingFailedError'
  }
}

/**
 * Thrown when model loading fails
 */
export class ModelLoadError extends AIError {
  constructor(modelId: string, reason: string) {
    super(`Failed to load model ${modelId}: ${reason}`, 'MODEL_LOAD_ERROR', false)
    this.name = 'ModelLoadError'
  }
}

/**
 * Thrown when inference fails
 */
export class InferenceError extends AIError {
  constructor(reason: string) {
    super(`Inference failed: ${reason}`, 'INFERENCE_ERROR')
    this.name = 'InferenceError'
  }
}

/**
 * Thrown when vector database operations fail
 */
export class VectorDBError extends AIError {
  constructor(operation: string, reason: string) {
    super(`VectorDB ${operation} failed: ${reason}`, 'VECTOR_DB_ERROR')
    this.name = 'VectorDBError'
  }
}

/**
 * Thrown when hardware requirements are not met
 */
export class HardwareRequirementError extends AIError {
  constructor(requirement: string) {
    super(`Hardware requirement not met: ${requirement}`, 'HARDWARE_REQUIREMENT', false)
    this.name = 'HardwareRequirementError'
  }
}

/**
 * Thrown when conversation is not found
 */
export class ConversationNotFoundError extends AIError {
  constructor(conversationId: string) {
    super(`Conversation not found: ${conversationId}`, 'CONVERSATION_NOT_FOUND')
    this.name = 'ConversationNotFoundError'
  }
}
