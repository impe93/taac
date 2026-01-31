/**
 * Model Registry
 *
 * Maintains a curated list of tested LLM models with:
 * - Download URLs and checksums
 * - Hardware requirements per model
 * - Model metadata (size, quantization, context)
 *
 * Reference: docs/AI_ARCHITECTURE.md section 6.4
 */

import type { ModelDefinition, HardwareTier } from './types'

/**
 * Curated list of tested models organized by hardware tier
 */
const CURATED_MODELS: ModelDefinition[] = [
  // ============================================================================
  // LOW TIER - CPU-friendly models (< 4GB)
  // ============================================================================
  {
    id: 'phi-3-mini-q4',
    name: 'Phi-3 Mini 4K (Q4_K_M)',
    description: 'Microsoft Phi-3 Mini optimized for resource-constrained environments',
    filename: 'Phi-3-mini-4k-instruct-Q4_K_M.gguf',
    sizeBytes: 2.3 * 1024 * 1024 * 1024, // ~2.3GB
    layers: 32,
    quantization: 'Q4_K_M',
    contextLength: 4096,
    capabilities: ['chat'],
    hardwareTier: 'low',
    downloadUrl:
      'https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-gguf/resolve/main/Phi-3-mini-4k-instruct-q4.gguf',
    license: 'MIT'
  },
  {
    id: 'qwen2-1.5b-q8',
    name: 'Qwen2 1.5B (Q8_0)',
    description: 'Alibaba Qwen2 1.5B parameter model, excellent for lightweight inference',
    filename: 'qwen2-1_5b-instruct-q8_0.gguf',
    sizeBytes: 1.6 * 1024 * 1024 * 1024, // ~1.6GB
    layers: 28,
    quantization: 'Q8_0',
    contextLength: 32768,
    capabilities: ['chat'],
    hardwareTier: 'low',
    downloadUrl:
      'https://huggingface.co/Qwen/Qwen2-1.5B-Instruct-GGUF/resolve/main/qwen2-1_5b-instruct-q8_0.gguf',
    license: 'Apache 2.0'
  },

  // ============================================================================
  // MEDIUM TIER - Balanced models (4-8GB)
  // ============================================================================
  {
    id: 'llama-3.1-8b-q4',
    name: 'Llama 3.1 8B (Q4_K_M)',
    description: 'Meta Llama 3.1 8B parameter model with strong general capabilities',
    filename: 'Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf',
    sizeBytes: 4.9 * 1024 * 1024 * 1024, // ~4.9GB
    layers: 32,
    quantization: 'Q4_K_M',
    contextLength: 131072,
    capabilities: ['chat', 'code', 'reasoning'],
    hardwareTier: 'medium',
    downloadUrl:
      'https://huggingface.co/lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf',
    license: 'Llama 3.1 Community License'
  },
  {
    id: 'mistral-7b-q4',
    name: 'Mistral 7B (Q4_K_M)',
    description: 'Mistral 7B instruction-tuned model for advanced chat capabilities',
    filename: 'mistral-7b-instruct-v0.3.Q4_K_M.gguf',
    sizeBytes: 4.4 * 1024 * 1024 * 1024, // ~4.4GB
    layers: 32,
    quantization: 'Q4_K_M',
    contextLength: 32768,
    capabilities: ['chat', 'code'],
    hardwareTier: 'medium',
    downloadUrl:
      'https://huggingface.co/MaziyarPanahi/Mistral-7B-Instruct-v0.3-GGUF/resolve/main/Mistral-7B-Instruct-v0.3.Q4_K_M.gguf',
    license: 'Apache 2.0'
  },

  // ============================================================================
  // HIGH TIER - High-quality models (8-16GB)
  // ============================================================================
  {
    id: 'llama-3.1-8b-q8',
    name: 'Llama 3.1 8B (Q8_0)',
    description: 'Meta Llama 3.1 8B with higher quantization for better quality output',
    filename: 'Meta-Llama-3.1-8B-Instruct-Q8_0.gguf',
    sizeBytes: 8.5 * 1024 * 1024 * 1024, // ~8.5GB
    layers: 32,
    quantization: 'Q8_0',
    contextLength: 131072,
    capabilities: ['chat', 'code', 'reasoning'],
    hardwareTier: 'high',
    downloadUrl:
      'https://huggingface.co/lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q8_0.gguf',
    license: 'Llama 3.1 Community License'
  },
  {
    id: 'deepseek-coder-6.7b-q8',
    name: 'DeepSeek Coder 6.7B (Q8_0)',
    description: 'DeepSeek Coder specialized for code generation and understanding',
    filename: 'deepseek-coder-6.7b-instruct-Q8_0.gguf',
    sizeBytes: 7.2 * 1024 * 1024 * 1024, // ~7.2GB
    layers: 32,
    quantization: 'Q8_0',
    contextLength: 16384,
    capabilities: ['chat', 'code'],
    hardwareTier: 'high',
    downloadUrl:
      'https://huggingface.co/TheBloke/deepseek-coder-6.7B-instruct-GGUF/resolve/main/deepseek-coder-6.7b-instruct.Q8_0.gguf',
    license: 'DeepSeek License'
  },

  // ============================================================================
  // ULTRA TIER - Premium models (16GB+)
  // ============================================================================
  {
    id: 'llama-3.1-70b-q4',
    name: 'Llama 3.1 70B (Q4_K_M)',
    description: 'Meta Llama 3.1 70B parameter model for maximum capability and intelligence',
    filename: 'Meta-Llama-3.1-70B-Instruct-Q4_K_M.gguf',
    sizeBytes: 42.5 * 1024 * 1024 * 1024, // ~42.5GB
    layers: 80,
    quantization: 'Q4_K_M',
    contextLength: 131072,
    capabilities: ['chat', 'code', 'reasoning'],
    hardwareTier: 'ultra',
    downloadUrl:
      'https://huggingface.co/lmstudio-community/Meta-Llama-3.1-70B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-70B-Instruct-Q4_K_M.gguf',
    license: 'Llama 3.1 Community License'
  },

  // ============================================================================
  // EMBEDDING MODELS - For vector search and RAG
  // ============================================================================
  {
    id: 'nomic-embed-text-v1.5',
    name: 'Nomic Embed Text v1.5 (Q8_0)',
    description: 'High-quality text embedding model for semantic search with 8192 token context',
    filename: 'nomic-embed-text-v1.5.Q8_0.gguf',
    sizeBytes: 137 * 1024 * 1024, // ~137MB
    layers: 12,
    quantization: 'Q8_0',
    contextLength: 8192,
    capabilities: ['embedding'],
    hardwareTier: 'low',
    downloadUrl:
      'https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q8_0.gguf',
    license: 'Apache 2.0'
  },
  {
    id: 'bge-small-en-v1.5',
    name: 'BGE Small EN v1.5 (F16)',
    description: 'Compact BAAI embedding model optimized for English text retrieval',
    filename: 'bge-small-en-v1.5-f16.gguf',
    sizeBytes: 66 * 1024 * 1024, // ~66MB
    layers: 12,
    quantization: 'F16',
    contextLength: 512,
    capabilities: ['embedding'],
    hardwareTier: 'low',
    downloadUrl:
      'https://huggingface.co/CompendiumLabs/bge-small-en-v1.5-gguf/resolve/main/bge-small-en-v1.5-f16.gguf',
    license: 'MIT'
  }
]

/**
 * Static registry for managing curated AI models
 */
export class ModelRegistry {
  private static models: Map<string, ModelDefinition> = new Map(
    CURATED_MODELS.map((m) => [m.id, m])
  )

  /**
   * Get a model by ID
   */
  static getModel(id: string): ModelDefinition | undefined {
    return this.models.get(id)
  }

  /**
   * Get a model by filename
   */
  static getModelByFilename(filename: string): ModelDefinition | undefined {
    for (const model of this.models.values()) {
      if (model.filename === filename) return model
    }
    return undefined
  }

  /**
   * Get all available models
   */
  static getAllModels(): ModelDefinition[] {
    return Array.from(this.models.values())
  }

  /**
   * Get models suitable for a hardware tier (includes all lower tier models)
   */
  static getModelsForTier(tier: HardwareTier): ModelDefinition[] {
    const tierOrder: HardwareTier[] = ['low', 'medium', 'high', 'ultra']
    const tierIndex = tierOrder.indexOf(tier)

    return Array.from(this.models.values()).filter((m) => {
      const modelTierIndex = tierOrder.indexOf(m.hardwareTier)
      return modelTierIndex <= tierIndex
    })
  }

  /**
   * Get chat-capable models
   */
  static getChatModels(): ModelDefinition[] {
    return Array.from(this.models.values()).filter((m) => m.capabilities.includes('chat'))
  }

  /**
   * Get embedding models
   */
  static getEmbeddingModels(): ModelDefinition[] {
    return Array.from(this.models.values()).filter((m) => m.capabilities.includes('embedding'))
  }

  /**
   * Get recommended models for a hardware tier
   */
  static getRecommendedModels(tier: HardwareTier): {
    chat: ModelDefinition | undefined
    embedding: ModelDefinition | undefined
  } {
    const compatible = this.getModelsForTier(tier)

    // Get the most capable compatible chat model (highest tier that fits)
    const chatModels = compatible
      .filter((m) => m.capabilities.includes('chat'))
      .sort((a, b) => {
        const tierOrder: HardwareTier[] = ['low', 'medium', 'high', 'ultra']
        return tierOrder.indexOf(b.hardwareTier) - tierOrder.indexOf(a.hardwareTier)
      })

    // Get the smallest embedding model (they're all good quality)
    const embeddingModels = compatible
      .filter((m) => m.capabilities.includes('embedding'))
      .sort((a, b) => a.sizeBytes - b.sizeBytes)

    return {
      chat: chatModels[0],
      embedding: embeddingModels[0]
    }
  }

  /**
   * Check if a model is compatible with a tier
   */
  static isCompatible(modelId: string, tier: HardwareTier): boolean {
    const model = this.getModel(modelId)
    if (!model) return false

    const tierOrder: HardwareTier[] = ['low', 'medium', 'high', 'ultra']
    return tierOrder.indexOf(model.hardwareTier) <= tierOrder.indexOf(tier)
  }

  /**
   * Format model size for display (bytes to human-readable)
   */
  static formatSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let unitIndex = 0
    let size = bytes

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024
      unitIndex++
    }

    // Use 1 decimal place for GB/TB, no decimals for smaller units
    const decimals = unitIndex >= 3 ? 1 : 0
    return `${size.toFixed(decimals)} ${units[unitIndex]}`
  }
}
