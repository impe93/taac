/**
 * AI Module - Custom Error Classes
 *
 * Contains all custom error classes for the AI subsystem.
 * Reference: docs/AI_ARCHITECTURE.md section 12
 */

/**
 * Base class for all AI-related errors
 */
export class AIError extends Error {
  constructor(
    message: string,
    public readonly code: string
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
    super('AIManager not initialized. Call initialize() first.', 'AI_NOT_INITIALIZED')
    this.name = 'AINotInitializedError'
  }
}

/**
 * Thrown when a requested model is not found
 */
export class ModelNotFoundError extends AIError {
  constructor(modelId: string) {
    super(`Model not found: ${modelId}`, 'MODEL_NOT_FOUND')
    this.name = 'ModelNotFoundError'
  }
}

/**
 * Thrown when a model file is not downloaded
 */
export class ModelNotDownloadedError extends AIError {
  constructor(modelId: string) {
    super(`Model not downloaded: ${modelId}`, 'MODEL_NOT_DOWNLOADED')
    this.name = 'ModelNotDownloadedError'
  }
}

/**
 * Thrown when model loading fails
 */
export class ModelLoadError extends AIError {
  constructor(modelId: string, reason: string) {
    super(`Failed to load model ${modelId}: ${reason}`, 'MODEL_LOAD_ERROR')
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
 * Thrown when download fails
 */
export class DownloadError extends AIError {
  constructor(modelId: string, reason: string) {
    super(`Download failed for ${modelId}: ${reason}`, 'DOWNLOAD_ERROR')
    this.name = 'DownloadError'
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
    super(`Hardware requirement not met: ${requirement}`, 'HARDWARE_REQUIREMENT')
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
