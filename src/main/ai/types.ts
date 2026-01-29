/**
 * AI Module - Shared TypeScript Types
 *
 * Contains all shared type definitions for the AI subsystem.
 * Reference: docs/AI_ARCHITECTURE.md
 */

// TODO: Implement hardware detection types
export interface HardwareInfo {
  cpu: CPUInfo
  ram: RAMInfo
  gpu: GPUInfo
  tier: HardwareTier
}

export interface CPUInfo {
  model: string
  cores: number
  threads: number
}

export interface RAMInfo {
  total: number // bytes
  available: number // bytes
}

export interface GPUInfo {
  model: string | null
  vram: number | null // bytes
  hasCuda: boolean
  hasMetal: boolean
  hasVulkan: boolean
}

export type HardwareTier = 'low' | 'medium' | 'high' | 'ultra'

// TODO: Implement model types
export interface ModelDefinition {
  id: string
  name: string
  filename: string
  sizeBytes: number
  quantization: string
  contextSize: number
  type: 'chat' | 'embedding'
  minTier: HardwareTier
  downloadUrl: string
  sha256?: string
}

export interface LoadedModel {
  id: string
  lastUsed: number
  memoryUsage: number
}

// TODO: Implement chat types
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp?: number
}

export interface GenerationOptions {
  maxTokens?: number
  temperature?: number
  topP?: number
  stopSequences?: string[]
}

export interface ChatCompletionResult {
  response: string
  tokensUsed: number
}

// TODO: Implement conversation types
export interface Conversation {
  id: string
  title: string
  messages: ChatMessage[]
  modelId: string
  createdAt: number
  updatedAt: number
  noteReferences: NoteReference[]
}

export interface NoteReference {
  spaceId: string
  noteId: string
  notePath: string
}

// TODO: Implement vector DB types
export interface EmbeddingResult {
  noteId: string
  chunkIndex: number
  embedding: number[]
  text: string
}

export interface SearchResult {
  noteId: string
  notePath: string
  spaceId: string
  chunkText: string
  score: number
}

// TODO: Implement download types
export interface DownloadProgress {
  modelId: string
  downloadedBytes: number
  totalBytes: number
  percentage: number
  speed: number // bytes per second
  status: 'pending' | 'downloading' | 'paused' | 'completed' | 'error'
  error?: string
}
