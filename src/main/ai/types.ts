/**
 * AI Module - Shared TypeScript Types
 *
 * Contains all shared type definitions for the AI subsystem.
 * Reference: docs/AI_ARCHITECTURE.md Appendix A
 */

// ============================================================================
// HARDWARE TYPES
// ============================================================================

/**
 * Hardware tier classification for model recommendations
 */
export type HardwareTier = 'low' | 'medium' | 'high' | 'ultra'

/**
 * CPU information
 */
export interface CPUInfo {
  brand: string
  cores: number
  physicalCores: number
  speed: number
}

/**
 * Memory information
 */
export interface MemoryInfo {
  totalBytes: number
  availableBytes: number
}

/**
 * GPU information for hardware detection
 */
export interface GPUInfo {
  name: string
  vendor: string
  vramBytes: number | null
  hasCuda: boolean
  hasMetal: boolean
  hasVulkan: boolean
  driverVersion: string | null
}

/**
 * Complete hardware information for the system
 */
export interface HardwareInfo {
  cpu: CPUInfo
  memory: MemoryInfo
  gpu: GPUInfo
  platform: NodeJS.Platform
  tier: HardwareTier
}

// ============================================================================
// MODEL TYPES
// ============================================================================

/**
 * Model capability types
 */
export type ModelCapability = 'chat' | 'embedding' | 'code' | 'reasoning' | 'transcription' | 'diarization'

/**
 * Performance estimation levels
 */
export type EstimatedPerformance = 'slow' | 'moderate' | 'fast' | 'very-fast'

/**
 * Additional file entry for multi-file models (e.g. Whisper ONNX encoder/decoder/tokens)
 */
export interface ModelFile {
  role: string
  filename: string
  downloadUrl: string
}

/**
 * Definition of an AI model available for download
 */
export interface ModelDefinition {
  id: string
  name: string
  description: string
  filename: string
  downloadUrl: string
  sizeBytes: number
  layers: number
  contextLength: number
  quantization: string
  capabilities: ModelCapability[]
  hardwareTier: HardwareTier
  license: string
  /** Additional files required by multi-file models (e.g. Whisper ONNX encoder/decoder/tokens) */
  files?: ModelFile[]
}

/**
 * Model recommendation based on hardware capabilities
 */
export interface ModelRecommendation {
  modelId: string
  reason: string
  estimatedPerformance: EstimatedPerformance
  gpuLayersRecommended: number // -1 = all layers
}

/**
 * Information about a loaded model in memory
 */
export interface LoadedModel {
  id: string
  lastUsed: number
  memoryUsage: number
}

// ============================================================================
// DOWNLOAD TYPES
// ============================================================================

/**
 * Download status for model downloads
 */
export type DownloadStatus = 'pending' | 'downloading' | 'paused' | 'completed' | 'error'

/**
 * Progress information for model downloads
 */
export interface DownloadProgress {
  modelId: string
  filename: string
  bytesDownloaded: number
  totalBytes: number
  percentage: number
  speed: number // bytes per second
  eta: number // seconds remaining
  status: DownloadStatus
  error?: string
}

// ============================================================================
// CHAT TYPES
// ============================================================================

/**
 * Role in a chat conversation
 */
export type ChatRole = 'user' | 'assistant' | 'system'

/**
 * A single message in a conversation
 */
export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  timestamp: string
  noteReferences?: NoteReference[]
  metadata?: Record<string, unknown>
}

/**
 * Reference to a note used in conversation context
 */
export interface NoteReference {
  noteId: string
  spaceId: string
  title: string
  excerpt: string
  relevanceScore?: number
}

/**
 * Options for text generation
 */
export interface GenerationOptions {
  maxTokens?: number
  temperature?: number
  topP?: number
  stopSequences?: string[]
  isolated?: boolean
}

/**
 * Result from a chat completion
 */
export interface ChatCompletionResult {
  response: string
  tokensUsed: number
}

// ============================================================================
// CONVERSATION TYPES
// ============================================================================

/**
 * Metadata associated with a conversation
 */
export interface ConversationMetadata {
  totalTokens: number
  lastModelResponse?: string
}

/**
 * Full conversation with all messages
 */
export interface Conversation {
  id: string
  title: string
  modelId: string
  systemPrompt?: string
  messages: ChatMessage[]
  noteContext: NoteReference[]
  createdAt: string
  updatedAt: string
  metadata: ConversationMetadata
}

/**
 * Summary of a conversation for listing
 */
export interface ConversationSummary {
  id: string
  title: string
  modelId: string
  messageCount: number
  noteCount: number
  createdAt: string
  updatedAt: string
}

// ============================================================================
// VECTOR DATABASE TYPES
// ============================================================================

/**
 * A document stored in the vector database
 */
export interface VectorDocument {
  id: string
  noteId: string
  chunkIndex: number
  content: string
  embedding?: number[]
  embeddingModel?: string
  sectionId?: string
  sectionHeader?: string
  metadata?: Record<string, unknown>
}

/**
 * Result from a vector similarity search
 */
export interface SearchResult {
  id: string
  noteId: string
  content: string
  distance: number
  sectionId?: string
  sectionHeader?: string
  metadata: Record<string, unknown>
}

/**
 * Result from a BM25 (keyword) search via FTS5.
 * Note: bm25Score is the raw FTS5 rank value, which is negative.
 * More negative = more relevant (e.g. -5.2 is more relevant than -1.3).
 */
export interface BM25SearchResult {
  id: string
  noteId: string
  content: string
  sectionId?: string
  sectionHeader?: string
  metadata: Record<string, unknown>
  bm25Score: number
}

/**
 * Options for hybrid search combining vector KNN and BM25.
 * Reference: docs/RAG_ARCHITECTURE.md §8.4
 */
export interface HybridSearchOptions {
  query: string
  queryEmbedding: Float32Array
  limit: number
  vectorWeight?: number // default 1.0
  bm25Weight?: number // default 0.7
  rrfK?: number // default 60
  noteIds?: string[]
  contextWindow?: number // default 1
  tokenBudget?: number // default 4000
}

/**
 * A single result from hybrid search, ranked by Reciprocal Rank Fusion.
 * Reference: docs/RAG_ARCHITECTURE.md §8.4
 */
export interface RankedResult {
  id: string
  noteId: string
  chunkIndex: number
  content: string
  sectionId: string | null
  sectionHeader: string | null
  metadata: Record<string, unknown>
  rrfScore: number
  relevancePercent: number // 0-100, relative to best result in the set
  vectorDistance: number | null // null if found only via BM25
  bm25Rank: number | null // null if found only via vector
}

/**
 * A result after window expansion — contains the original RankedResult fields
 * plus the concatenated content of adjacent chunks and the effective range.
 * Reference: docs/RAG_ARCHITECTURE.md §10.2
 */
export interface ExpandedResult extends RankedResult {
  expandedContent: string
  chunkRange: { from: number; to: number }
}

/**
 * Result from embedding generation
 */
export interface EmbeddingResult {
  noteId: string
  chunkIndex: number
  embedding: number[]
  text: string
}

// ============================================================================
// CHUNKING TYPES
// ============================================================================

/**
 * Options for text chunking during indexing (token-based)
 */
export interface ChunkingOptions {
  maxChunkTokens: number
  overlapTokens: number
  splitOnParagraph: boolean
}

/**
 * Default chunking options (token-based)
 * 256 tokens per chunk with 32 token overlap suits embedding models with 512 token context
 */
export const DEFAULT_CHUNKING_OPTIONS: ChunkingOptions = {
  maxChunkTokens: 256,
  overlapTokens: 32,
  splitOnParagraph: true
}

/**
 * A structure-aware chunk with section metadata.
 * Reference: docs/RAG_ARCHITECTURE.md §5.4
 */
export interface StructuredChunk {
  text: string
  index: number
  sectionId: string
  sectionHeader: string
  startOffset: number
  endOffset: number
}

/**
 * Options for structure-aware chunking.
 * Reference: docs/RAG_ARCHITECTURE.md §5.3
 */
export interface StructureAwareChunkingOptions {
  maxChunkTokens?: number
  overlapTokens?: number
  minChunkTokens?: number
}

/**
 * Default structure-aware chunking options
 */
export const DEFAULT_STRUCTURE_AWARE_OPTIONS: Required<StructureAwareChunkingOptions> = {
  maxChunkTokens: 384,
  overlapTokens: 32,
  minChunkTokens: 32
}
