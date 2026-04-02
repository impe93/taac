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
import type { ModelFormat } from './types'

// Re-export for use in AudioManager without importing types.ts directly
export type { ModelFormat }

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
  },

  // ============================================================================
  // TRANSCRIPTION MODELS - Whisper ONNX via sherpa-onnx (§5.2)
  // ============================================================================
  {
    id: 'whisper-base-onnx',
    name: 'Whisper Base (ONNX)',
    description:
      'OpenAI Whisper base model in ONNX format — good accuracy for clear audio with fast inference (~142MB)',
    filename: 'base-encoder.int8.onnx',
    sizeBytes: 142 * 1024 * 1024, // ~142MB
    layers: 0,
    quantization: 'fp32',
    contextLength: 0,
    capabilities: ['transcription'],
    hardwareTier: 'low',
    downloadUrl:
      'https://huggingface.co/csukuangfj/sherpa-onnx-whisper-base/resolve/main/base-encoder.int8.onnx',
    files: [
      {
        role: 'encoder',
        filename: 'base-encoder.int8.onnx',
        downloadUrl:
          'https://huggingface.co/csukuangfj/sherpa-onnx-whisper-base/resolve/main/base-encoder.int8.onnx'
      },
      {
        role: 'decoder',
        filename: 'base-decoder.int8.onnx',
        downloadUrl:
          'https://huggingface.co/csukuangfj/sherpa-onnx-whisper-base/resolve/main/base-decoder.int8.onnx'
      },
      {
        role: 'tokens',
        filename: 'base-tokens.txt',
        downloadUrl:
          'https://huggingface.co/csukuangfj/sherpa-onnx-whisper-base/resolve/main/base-tokens.txt'
      }
    ],
    license: 'MIT'
  },
  {
    id: 'whisper-small-onnx',
    name: 'Whisper Small (ONNX)',
    description:
      'OpenAI Whisper small model in ONNX format — good accuracy/speed balance for multilingual transcription (~466MB)',
    filename: 'small-encoder.int8.onnx',
    sizeBytes: 466 * 1024 * 1024, // ~466MB
    layers: 0,
    quantization: 'int8',
    contextLength: 0,
    capabilities: ['transcription'],
    hardwareTier: 'medium',
    downloadUrl:
      'https://huggingface.co/csukuangfj/sherpa-onnx-whisper-small/resolve/main/small-encoder.int8.onnx',
    files: [
      {
        role: 'encoder',
        filename: 'small-encoder.int8.onnx',
        downloadUrl:
          'https://huggingface.co/csukuangfj/sherpa-onnx-whisper-small/resolve/main/small-encoder.int8.onnx'
      },
      {
        role: 'decoder',
        filename: 'small-decoder.int8.onnx',
        downloadUrl:
          'https://huggingface.co/csukuangfj/sherpa-onnx-whisper-small/resolve/main/small-decoder.int8.onnx'
      },
      {
        role: 'tokens',
        filename: 'small-tokens.txt',
        downloadUrl:
          'https://huggingface.co/csukuangfj/sherpa-onnx-whisper-small/resolve/main/small-tokens.txt'
      }
    ],
    license: 'MIT'
  },
  {
    id: 'whisper-large-v3-turbo-onnx',
    name: 'Whisper Large v3 Turbo (ONNX)',
    description:
      'OpenAI Whisper large-v3-turbo model in ONNX format — near-best accuracy at 8x the speed of large-v3 (~1.6GB)',
    filename: 'turbo-encoder.int8.onnx',
    sizeBytes: 1.6 * 1024 * 1024 * 1024, // ~1.6GB
    layers: 0,
    quantization: 'int8',
    contextLength: 0,
    capabilities: ['transcription'],
    hardwareTier: 'high',
    downloadUrl:
      'https://huggingface.co/csukuangfj/sherpa-onnx-whisper-turbo/resolve/main/turbo-encoder.int8.onnx',
    files: [
      {
        role: 'encoder',
        filename: 'turbo-encoder.int8.onnx',
        downloadUrl:
          'https://huggingface.co/csukuangfj/sherpa-onnx-whisper-turbo/resolve/main/turbo-encoder.int8.onnx'
      },
      {
        role: 'decoder',
        filename: 'turbo-decoder.int8.onnx',
        downloadUrl:
          'https://huggingface.co/csukuangfj/sherpa-onnx-whisper-turbo/resolve/main/turbo-decoder.int8.onnx'
      },
      {
        role: 'tokens',
        filename: 'turbo-tokens.txt',
        downloadUrl:
          'https://huggingface.co/csukuangfj/sherpa-onnx-whisper-turbo/resolve/main/turbo-tokens.txt'
      }
    ],
    license: 'MIT'
  },

  // ============================================================================
  // TRANSCRIPTION MODELS — Whisper GGML via whisper.cpp / @fugood/whisper.node
  // GPU-accelerated (Metal on macOS Apple Silicon, CUDA on Windows/Linux)
  // ============================================================================
  {
    id: 'whisper-base-ggml',
    name: 'Whisper Base (GGML - GPU)',
    description:
      'OpenAI Whisper base model in GGML format — GPU-accelerated via Metal/CUDA (~142MB)',
    filename: 'ggml-base.bin',
    sizeBytes: 142 * 1024 * 1024,
    layers: 0,
    quantization: 'fp32',
    contextLength: 0,
    format: 'ggml' as const,
    capabilities: ['transcription'],
    hardwareTier: 'low',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
    license: 'MIT'
  },
  {
    id: 'whisper-small-ggml',
    name: 'Whisper Small (GGML - GPU)',
    description:
      'OpenAI Whisper small model in GGML format — GPU-accelerated, better multilingual accuracy (~466MB)',
    filename: 'ggml-small.bin',
    sizeBytes: 466 * 1024 * 1024,
    layers: 0,
    quantization: 'fp32',
    contextLength: 0,
    format: 'ggml' as const,
    capabilities: ['transcription'],
    hardwareTier: 'medium',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
    license: 'MIT'
  },
  {
    id: 'whisper-large-v3-turbo-ggml',
    name: 'Whisper Large v3 Turbo (GGML - GPU)',
    description:
      'OpenAI Whisper large-v3-turbo in GGML format — best accuracy at 8x speed of large-v3 (~809MB)',
    filename: 'ggml-large-v3-turbo.bin',
    sizeBytes: 809 * 1024 * 1024,
    layers: 0,
    quantization: 'fp32',
    contextLength: 0,
    format: 'ggml' as const,
    capabilities: ['transcription'],
    hardwareTier: 'high',
    downloadUrl:
      'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin',
    license: 'MIT'
  },

  // ============================================================================
  // DIARIZATION MODELS - Speaker segmentation & embedding via sherpa-onnx (§5.3)
  // Small enough to bundle with the app or auto-download silently during onboarding.
  // ============================================================================
  {
    id: 'sherpa-onnx-pyannote-segmentation',
    name: 'Speaker Segmentation (pyannote)',
    description:
      'Pyannote speaker segmentation model — identifies when different speakers talk (~5MB). Intended to be bundled with the app.',
    filename: 'model.onnx',
    sizeBytes: 5 * 1024 * 1024, // ~5MB
    layers: 0,
    quantization: 'fp32',
    contextLength: 0,
    capabilities: ['diarization'],
    hardwareTier: 'low',
    downloadUrl:
      'https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/resolve/main/model.onnx',
    license: 'MIT'
  },
  {
    id: 'sherpa-onnx-3dspeaker-embedding',
    name: 'Speaker Embedding (3D-Speaker)',
    description:
      'ERes2Net speaker embedding model — creates voice fingerprints to cluster speakers (~40MB). Intended to be bundled with the app.',
    filename: '3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx',
    sizeBytes: 40 * 1024 * 1024, // ~40MB
    layers: 0,
    quantization: 'fp32',
    contextLength: 0,
    capabilities: ['diarization'],
    hardwareTier: 'low',
    downloadUrl:
      'https://huggingface.co/csukuangfj/speaker-embedding-models/resolve/main/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx',
    license: 'Apache 2.0'
  },
  {
    id: 'sherpa-onnx-nemo-titanet-small',
    name: 'Speaker Embedding (NeMo TitaNet Small)',
    description:
      'NVIDIA NeMo TitaNet Small — ~2.7x faster speaker embedding extraction with comparable accuracy (~40MB)',
    filename: 'nemo_en_titanet_small.onnx',
    sizeBytes: 40.3 * 1024 * 1024, // ~40.3MB
    layers: 0,
    quantization: 'fp32',
    contextLength: 0,
    capabilities: ['diarization'],
    hardwareTier: 'low',
    downloadUrl:
      'https://huggingface.co/csukuangfj/speaker-embedding-models/resolve/main/nemo_en_titanet_small.onnx',
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
   * Get all transcription models (both GGML GPU and ONNX CPU)
   */
  static getTranscriptionModels(): ModelDefinition[] {
    return Array.from(this.models.values()).filter((m) => m.capabilities.includes('transcription'))
  }

  /**
   * Get GGML transcription models (whisper.cpp, GPU-accelerated)
   */
  static getGgmlTranscriptionModels(): ModelDefinition[] {
    return Array.from(this.models.values()).filter(
      (m) => m.capabilities.includes('transcription') && m.format === 'ggml'
    )
  }

  /**
   * Get ONNX transcription models (sherpa-onnx, CPU)
   */
  static getOnnxTranscriptionModels(): ModelDefinition[] {
    return Array.from(this.models.values()).filter(
      (m) => m.capabilities.includes('transcription') && m.format !== 'ggml'
    )
  }

  /**
   * Get diarization models (speaker segmentation and embedding)
   */
  static getDiarizationModels(): ModelDefinition[] {
    return Array.from(this.models.values()).filter((m) => m.capabilities.includes('diarization'))
  }

  /**
   * Get recommended models for a hardware tier.
   *
   * @param tier      Hardware tier for filtering compatible models
   * @param hasGpu    Whether GPU is available — if true, GGML transcription models are preferred
   */
  static getRecommendedModels(
    tier: HardwareTier,
    hasGpu = false
  ): {
    chat: ModelDefinition | undefined
    embedding: ModelDefinition | undefined
    transcription: ModelDefinition | undefined
  } {
    const compatible = this.getModelsForTier(tier)
    const tierOrder: HardwareTier[] = ['low', 'medium', 'high', 'ultra']

    // Get the most capable compatible chat model (highest tier that fits)
    const chatModels = compatible
      .filter((m) => m.capabilities.includes('chat'))
      .sort((a, b) => tierOrder.indexOf(b.hardwareTier) - tierOrder.indexOf(a.hardwareTier))

    // Get the smallest embedding model (they're all good quality)
    const embeddingModels = compatible
      .filter((m) => m.capabilities.includes('embedding'))
      .sort((a, b) => a.sizeBytes - b.sizeBytes)

    // Prefer GGML (GPU) models when GPU is available, fall back to ONNX (CPU) (§7.4)
    const transcriptionCandidates = compatible
      .filter((m) => m.capabilities.includes('transcription'))
      .filter((m) => (hasGpu ? m.format === 'ggml' : m.format !== 'ggml'))
      .sort((a, b) => tierOrder.indexOf(b.hardwareTier) - tierOrder.indexOf(a.hardwareTier))

    // If GPU preferred but no GGML model fits the tier, fall back to ONNX
    const transcriptionModels =
      transcriptionCandidates.length > 0
        ? transcriptionCandidates
        : compatible
            .filter((m) => m.capabilities.includes('transcription'))
            .sort((a, b) => tierOrder.indexOf(b.hardwareTier) - tierOrder.indexOf(a.hardwareTier))

    return {
      chat: chatModels[0],
      embedding: embeddingModels[0],
      transcription: transcriptionModels[0]
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
