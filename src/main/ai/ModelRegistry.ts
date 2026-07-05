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

import type { ModelDefinition, ModelFile, HardwareTier } from './types'
import type { ModelFormat } from './types'

// Re-export for use in AudioManager without importing types.ts directly
export type { ModelFormat }

/**
 * Tokenizer/config assets shared by the mlx-community Qwen3-ASR checkpoints.
 * Sizes verified against the HuggingFace tree API (2026-07).
 */
const QWEN3_ASR_SHARED_FILES: Record<string, number> = {
  'chat_template.json': 1_161,
  'generation_config.json': 142,
  'merges.txt': 1_671_853,
  'preprocessor_config.json': 330,
  'tokenizer_config.json': 12_487,
  'vocab.json': 2_776_833
}

/**
 * Build the multi-file list for an mlx-community Qwen3-ASR checkpoint.
 * `checkpointFiles` holds the per-checkpoint entries (weights, index, config)
 * whose sizes differ between the 0.6B and 1.7B variants.
 */
function qwen3AsrMlxFiles(repo: string, checkpointFiles: Record<string, number>): ModelFile[] {
  return Object.entries({ ...checkpointFiles, ...QWEN3_ASR_SHARED_FILES }).map(
    ([filename, sizeBytes]) => ({
      role: filename === 'model.safetensors' ? 'weights' : 'config',
      filename,
      downloadUrl: `https://huggingface.co/${repo}/resolve/main/${filename}`,
      sizeBytes
    })
  )
}

/**
 * Curated list of tested models organized by hardware tier
 */
const CURATED_MODELS: ModelDefinition[] = [
  // ============================================================================
  // LOW TIER - Compact chat model (~2GB)
  // ============================================================================
  {
    id: 'qwen3-5-2b-q8',
    name: 'Qwen3.5 2B (Q8_0)',
    description:
      'Alibaba Qwen3.5 2B hybrid SSM/attention model with strong reasoning and multilingual capabilities',
    filename: 'Qwen3.5-2B-Q8_0.gguf',
    sizeBytes: 2.01 * 1024 * 1024 * 1024, // ~2.01GB
    layers: 24,
    quantization: 'Q8_0',
    contextLength: 65536,
    capabilities: ['chat', 'code', 'reasoning'],
    hardwareTier: 'low',
    downloadUrl: 'https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q8_0.gguf',
    license: 'Apache 2.0'
  },

  // ============================================================================
  // EMBEDDING MODELS - For vector search and RAG
  // ============================================================================
  {
    id: 'embeddinggemma-300m-q8',
    name: 'EmbeddingGemma 300M (Q8_0)',
    description:
      'Google EmbeddingGemma — state-of-the-art multilingual embedding model under 500M params, 100+ languages (~320MB)',
    filename: 'embeddinggemma-300M-Q8_0.gguf',
    sizeBytes: 320 * 1024 * 1024, // ~320MB
    layers: 24,
    quantization: 'Q8_0',
    contextLength: 2048,
    capabilities: ['embedding'],
    hardwareTier: 'low',
    downloadUrl:
      'https://huggingface.co/ggml-org/embeddinggemma-300m-GGUF/resolve/main/embeddinggemma-300M-Q8_0.gguf',
    // EmbeddingGemma requires these exact task prompts for good retrieval quality
    embeddingQueryPrompt: 'task: search result | query: %s',
    embeddingDocumentPrompt: 'title: none | text: %s',
    license: 'Gemma Terms of Use'
  },

  // ============================================================================
  // RERANKING MODELS - Cross-encoder rerankers for search result quality
  // ============================================================================
  {
    id: 'qwen3-reranker-0.6b-q8',
    name: 'Qwen3 Reranker 0.6B (Q8_0)',
    description:
      'Qwen3 cross-encoder reranker — improves search relevance by re-scoring query/document pairs (~596MB)',
    filename: 'qwen3-reranker-0.6b-q8_0.gguf',
    sizeBytes: 595_778_560, // ~596MB
    layers: 28,
    quantization: 'Q8_0',
    contextLength: 8192,
    capabilities: ['reranking'],
    hardwareTier: 'low',
    downloadUrl:
      'https://huggingface.co/ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF/resolve/main/qwen3-reranker-0.6b-q8_0.gguf',
    license: 'Apache 2.0'
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
  // REALTIME TRANSCRIPTION MODELS — Qwen3-ASR MLX via Python sidecar
  // macOS Apple Silicon only. Multi-file checkpoints downloaded into
  // {userData}/models/{modelId}/ and loaded from the local directory (offline).
  // ============================================================================
  {
    id: 'qwen3-asr-1.7b-mlx-8bit',
    name: 'Qwen3-ASR 1.7B (MLX 8-bit)',
    description:
      'Alibaba Qwen3-ASR 1.7B quantized 8-bit for Apple Silicon — realtime transcription with automatic language identification (~2.3GB)',
    filename: 'model.safetensors',
    sizeBytes: 2_467_856_503,
    layers: 0,
    quantization: '8-bit',
    contextLength: 0,
    format: 'mlx' as const,
    capabilities: ['transcription'],
    hardwareTier: 'medium',
    downloadUrl:
      'https://huggingface.co/mlx-community/Qwen3-ASR-1.7B-8bit/resolve/main/model.safetensors',
    files: [
      ...qwen3AsrMlxFiles('mlx-community/Qwen3-ASR-1.7B-8bit', {
        'model.safetensors': 2_463_307_541,
        'model.safetensors.index.json': 78_968,
        'config.json': 7_188
      })
    ],
    license: 'Apache 2.0'
  },
  {
    id: 'qwen3-asr-0.6b-mlx-8bit',
    name: 'Qwen3-ASR 0.6B (MLX 8-bit)',
    description:
      'Alibaba Qwen3-ASR 0.6B quantized 8-bit for Apple Silicon — lighter realtime transcription for low-memory machines (~1GB)',
    filename: 'model.safetensors',
    sizeBytes: 1_010_771_234,
    layers: 0,
    quantization: '8-bit',
    contextLength: 0,
    format: 'mlx' as const,
    capabilities: ['transcription'],
    hardwareTier: 'low',
    downloadUrl:
      'https://huggingface.co/mlx-community/Qwen3-ASR-0.6B-8bit/resolve/main/model.safetensors',
    files: [
      ...qwen3AsrMlxFiles('mlx-community/Qwen3-ASR-0.6B-8bit', {
        'model.safetensors': 1_006_229_426,
        'model.safetensors.index.json': 71_815,
        'config.json': 7_187
      })
    ],
    license: 'Apache 2.0'
  },

  // ============================================================================
  // VAD MODELS - Voice activity detection via sherpa-onnx
  // Segments live audio into utterances for realtime transcription.
  // ============================================================================
  {
    id: 'silero-vad-onnx',
    name: 'Silero VAD',
    description:
      'Silero voice activity detection model — segments speech in real time for live transcription (~1.8MB)',
    filename: 'silero_vad.onnx',
    sizeBytes: 1_807_522,
    layers: 0,
    quantization: 'fp32',
    contextLength: 0,
    capabilities: ['vad'],
    hardwareTier: 'low',
    downloadUrl: 'https://huggingface.co/csukuangfj/vad/resolve/main/silero_vad.onnx',
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
   * Get MLX transcription models (Qwen3-ASR realtime sidecar, macOS Apple Silicon)
   */
  static getMlxTranscriptionModels(): ModelDefinition[] {
    return Array.from(this.models.values()).filter(
      (m) => m.capabilities.includes('transcription') && m.format === 'mlx'
    )
  }

  /**
   * Get VAD models (voice activity detection via sherpa-onnx)
   */
  static getVadModels(): ModelDefinition[] {
    return Array.from(this.models.values()).filter((m) => m.capabilities.includes('vad'))
  }

  /**
   * Get reranking models (cross-encoder rerankers)
   */
  static getRerankerModels(): ModelDefinition[] {
    return Array.from(this.models.values()).filter((m) => m.capabilities.includes('reranking'))
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
   * @param tier  Hardware tier for filtering compatible models
   */
  static getRecommendedModels(tier: HardwareTier): {
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

    // Transcription is a single whisper.cpp (GGML) engine for both GPU and CPU —
    // pick the most capable that fits the tier.
    const transcriptionModels = compatible
      .filter((m) => m.capabilities.includes('transcription') && m.format === 'ggml')
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
