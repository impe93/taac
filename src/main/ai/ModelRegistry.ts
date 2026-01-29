/**
 * Model Registry
 *
 * Maintains a curated list of tested LLM models with:
 * - Download URLs and checksums
 * - Hardware requirements per model
 * - Model metadata (size, quantization, context)
 *
 * Reference: docs/AI_ARCHITECTURE.md section 6.3
 */

import type { ModelDefinition, HardwareTier } from './types'

/**
 * Curated list of tested models
 * TODO: Add more models after testing
 */
const MODELS: ModelDefinition[] = [
  // Chat models
  {
    id: 'phi-3-mini-4k-q4',
    name: 'Phi-3 Mini 4K (Q4_K_M)',
    description: 'Microsoft Phi-3 Mini optimized for resource-constrained environments',
    filename: 'Phi-3-mini-4k-instruct-Q4_K_M.gguf',
    sizeBytes: 2.4 * 1024 * 1024 * 1024, // ~2.4GB
    layers: 32,
    quantization: 'Q4_K_M',
    contextLength: 4096,
    capabilities: ['chat'],
    hardwareTier: 'low',
    downloadUrl:
      'https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-gguf/resolve/main/Phi-3-mini-4k-instruct-Q4_K_M.gguf',
    license: 'MIT'
  },
  {
    id: 'llama-3.2-3b-q4',
    name: 'Llama 3.2 3B (Q4_K_M)',
    description: 'Meta Llama 3.2 3B parameter model for general chat tasks',
    filename: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    sizeBytes: 2.0 * 1024 * 1024 * 1024, // ~2GB
    layers: 28,
    quantization: 'Q4_K_M',
    contextLength: 8192,
    capabilities: ['chat'],
    hardwareTier: 'low',
    downloadUrl:
      'https://huggingface.co/lmstudio-community/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    license: 'Llama 3.2 Community License'
  },
  {
    id: 'mistral-7b-q4',
    name: 'Mistral 7B (Q4_K_M)',
    description: 'Mistral 7B instruction-tuned model for advanced chat capabilities',
    filename: 'mistral-7b-instruct-v0.2.Q4_K_M.gguf',
    sizeBytes: 4.4 * 1024 * 1024 * 1024, // ~4.4GB
    layers: 32,
    quantization: 'Q4_K_M',
    contextLength: 8192,
    capabilities: ['chat', 'code'],
    hardwareTier: 'medium',
    downloadUrl:
      'https://huggingface.co/TheBloke/Mistral-7B-Instruct-v0.2-GGUF/resolve/main/mistral-7b-instruct-v0.2.Q4_K_M.gguf',
    license: 'Apache 2.0'
  },
  // Embedding models
  {
    id: 'nomic-embed-text-v1.5',
    name: 'Nomic Embed Text v1.5 (Q8_0)',
    description: 'High-quality text embedding model for semantic search',
    filename: 'nomic-embed-text-v1.5.Q8_0.gguf',
    sizeBytes: 140 * 1024 * 1024, // ~140MB
    layers: 12,
    quantization: 'Q8_0',
    contextLength: 8192,
    capabilities: ['embedding'],
    hardwareTier: 'low',
    downloadUrl:
      'https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q8_0.gguf',
    license: 'Apache 2.0'
  }
]

export class ModelRegistry {
  /**
   * Get all available models
   */
  static getAllModels(): ModelDefinition[] {
    return [...MODELS]
  }

  /**
   * Get a specific model by ID
   */
  static getModel(modelId: string): ModelDefinition | undefined {
    return MODELS.find((m) => m.id === modelId)
  }

  /**
   * Get models filtered by capability
   */
  static getModelsByCapability(capability: 'chat' | 'embedding' | 'code' | 'reasoning'): ModelDefinition[] {
    return MODELS.filter((m) => m.capabilities.includes(capability))
  }

  /**
   * Get models compatible with a hardware tier
   */
  static getModelsForTier(tier: HardwareTier): ModelDefinition[] {
    const tierOrder: HardwareTier[] = ['low', 'medium', 'high', 'ultra']
    const tierIndex = tierOrder.indexOf(tier)

    return MODELS.filter((m) => {
      const modelTierIndex = tierOrder.indexOf(m.hardwareTier)
      return modelTierIndex <= tierIndex
    })
  }

  /**
   * Get recommended models for a hardware tier
   */
  static getRecommendedModels(tier: HardwareTier): {
    chat: ModelDefinition | undefined
    embedding: ModelDefinition | undefined
  } {
    const compatible = this.getModelsForTier(tier)

    // Get the most capable compatible model of each type
    const chatModels = compatible.filter((m) => m.capabilities.includes('chat'))
    const embeddingModels = compatible.filter((m) => m.capabilities.includes('embedding'))

    return {
      chat: chatModels[chatModels.length - 1], // Last one is most capable
      embedding: embeddingModels[0] // Usually just one embedding model
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
}
