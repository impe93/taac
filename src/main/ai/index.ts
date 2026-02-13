/**
 * AI Module - Barrel Export
 *
 * Central export point for all AI-related modules.
 * Reference: docs/AI_ARCHITECTURE.md section 5
 */

// Types
export * from './types'

// Error classes
export * from './errors'

// Core managers
export { AIManager } from './AIManager'
export type { AIManagerConfig } from './AIManager'

export { HardwareDetector } from './HardwareDetector'

export { ModelRegistry } from './ModelRegistry'

export { ModelDownloader } from './ModelDownloader'
export type { ProgressListener } from './ModelDownloader'

export { VectorDBManager } from './VectorDBManager'
export type { VectorDBConfig } from './VectorDBManager'

export { ConversationManager } from './ConversationManager'

export { EmbeddingService } from './EmbeddingService'
export type { ExtendedChunkingOptions, TextChunk, IndexableNote } from './EmbeddingService'

export { IndexingQueue } from './IndexingQueue'
export type { IndexingJob, IndexingProgressEvent, IndexingQueueOptions } from './IndexingQueue'
