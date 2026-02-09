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
  // MEDIUM TIER - Balanced models (4-8GB)
  // ============================================================================
  {
    id: 'qwen3-4b-instruct-2507-q8',
    name: 'Qwen3 4B Instruct 2507 (Q8_0)',
    description:
      'Alibaba Qwen3 4B instruction-tuned model with strong reasoning and multilingual capabilities',
    filename: 'Qwen3-4B-Instruct-2507-Q8_0.gguf',
    sizeBytes: 4.28 * 1024 * 1024 * 1024, // ~4.28GB
    layers: 36,
    quantization: 'Q8_0',
    contextLength: 262144,
    capabilities: ['chat', 'code', 'reasoning'],
    hardwareTier: 'medium',
    downloadUrl:
      'https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q8_0.gguf',
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

  // ============================================================================
  // EMBEDDING MODELS - For vector search and RAG
  // ============================================================================
  {
    id: 'nomic-embed-text-v2-moe',
    name: 'Nomic Embed Text v2 MoE (Q8_0)',
    description:
      'High-quality multilingual embedding model with MoE architecture for semantic search (~100 languages)',
    filename: 'nomic-embed-text-v2-moe-q8_0.gguf',
    sizeBytes: 512 * 1024 * 1024, // ~512MB
    layers: 22,
    quantization: 'Q8_0',
    contextLength: 2048,
    capabilities: ['embedding'],
    hardwareTier: 'low',
    downloadUrl:
      'https://huggingface.co/ggml-org/Nomic-Embed-Text-V2-GGUF/resolve/main/nomic-embed-text-v2-moe-q8_0.gguf',
    license: 'Apache 2.0'
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
