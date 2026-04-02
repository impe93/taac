/**
 * DiarizationService — sherpa-onnx speaker diarization integration
 *
 * Wraps the sherpa-onnx offline speaker diarization pipeline to provide
 * local speaker identification. Uses a segmentation model (~5MB) to detect
 * speaker changes and an embedding model (~10MB) to cluster speakers.
 *
 * §3.3  initialize() is idempotent — safe to call multiple times
 * §3.4  dispose() tears down the diarizer and resets state
 * §3.5  type-only imports at top level; runtime dynamic import() inside initialize()
 * §3.7  all log lines are prefixed with [DiarizationService]
 *
 * Reference: docs/NOTE_TAKER.md §5.3, §5.5, §11.4
 */

import fs from 'node:fs/promises'
import os from 'node:os'
import type { DiarizationResult, DiarizationSegment } from './types'

// §3.5 — type-only import at top level; actual module loaded at runtime via
// dynamic import() inside initialize(), same pattern as node-llama-cpp.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SherpaOnnxModule = any

export class DiarizationService {
  /** Underlying sherpa-onnx offline speaker diarization instance */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private diarizer: any | null = null

  /** Cached sherpa-onnx module reference (set after dynamic import) */
  private sherpaOnnx: SherpaOnnxModule | null = null

  /** Guard flag for idempotent initialization (§3.3) */
  private initialized = false

  /**
   * Load the sherpa-onnx speaker diarization models.
   *
   * Both models must exist on disk before this method is called:
   *   - segmentationModelPath: path to segmentation .onnx file (~5MB)
   *   - embeddingModelPath:    path to speaker embedding .onnx file (~10MB)
   *
   * If either model file is missing, the service starts in degraded mode —
   * diarize() returns a single-speaker result instead of throwing, so the
   * pipeline can continue without crashing.
   *
   * @param segmentationModelPath  Absolute path to the segmentation ONNX model
   * @param embeddingModelPath     Absolute path to the speaker embedding ONNX model
   */
  async initialize(segmentationModelPath: string, embeddingModelPath: string): Promise<void> {
    // §3.3 — idempotent
    if (this.initialized) return

    console.log(
      `[DiarizationService] Initializing — segmentation: ${segmentationModelPath}, embedding: ${embeddingModelPath}`
    )

    // ------------------------------------------------------------------
    // 1. Verify model files exist
    // ------------------------------------------------------------------
    const segExists = await this.pathExists(segmentationModelPath)
    const embExists = await this.pathExists(embeddingModelPath)

    if (!segExists || !embExists) {
      const missing: string[] = []
      if (!segExists) missing.push(`segmentation: "${segmentationModelPath}"`)
      if (!embExists) missing.push(`embedding: "${embeddingModelPath}"`)
      console.warn(
        `[DiarizationService] Missing model file(s): ${missing.join(', ')}. ` +
          'Speaker diarization will be unavailable — single-speaker fallback will be used.'
      )
      // Do NOT set this.initialized = true — allow re-initialization after download
      return
    }

    console.log(`[DiarizationService] Found model files:`)
    console.log(`  segmentation: ${segmentationModelPath}`)
    console.log(`  embedding:    ${embeddingModelPath}`)

    // ------------------------------------------------------------------
    // 2. Dynamic import — §3.5 ESM pattern (same as node-llama-cpp)
    // ------------------------------------------------------------------
    const sherpaOnnxModule = await import('sherpa-onnx-node')
    // CJS module wrapped by dynamic import — exports are under .default
    const sherpaOnnx: SherpaOnnxModule = sherpaOnnxModule.default ?? sherpaOnnxModule
    this.sherpaOnnx = sherpaOnnx

    // ------------------------------------------------------------------
    // 3. Determine thread counts — with process isolation (utilityProcess),
    //    we can use more threads without starving the main process.
    //    Segmentation is lightweight → fewer threads.
    //    Embedding extraction is the bottleneck → more threads.
    // ------------------------------------------------------------------
    const cpuCount = os.cpus().length
    const segThreads = Math.max(2, Math.min(4, Math.floor(cpuCount / 4)))
    const embThreads = Math.max(2, Math.min(6, Math.floor(cpuCount / 2)))
    console.log(
      `[DiarizationService] Threads — segmentation: ${segThreads}, embedding: ${embThreads} (${cpuCount} logical CPUs)`
    )

    // ------------------------------------------------------------------
    // 4. Create the offline speaker diarization pipeline (§5.5 config layout)
    //    numClusters: -1 → auto-detect number of speakers
    // ------------------------------------------------------------------
    this.diarizer = new sherpaOnnx.OfflineSpeakerDiarization({
      segmentation: {
        pyannote: { model: segmentationModelPath },
        numThreads: segThreads,
        debug: 0
      },
      embedding: {
        model: embeddingModelPath,
        numThreads: embThreads,
        debug: 0
      },
      clustering: {
        numClusters: -1, // -1 = auto-detect
        threshold: 0.9 // higher threshold = fewer, more confident speaker clusters
      }
    })

    this.initialized = true
    console.log('[DiarizationService] Initialized successfully')
  }

  /**
   * Diarize a 16 kHz mono WAV file and return speaker-labelled time segments.
   *
   * Returns a single-speaker fallback result (rather than throwing) when the
   * service is in degraded mode (models not loaded), so the pipeline can continue.
   *
   * @param wavPath  Absolute path to the 16 kHz mono WAV file
   * @returns        DiarizationResult with speaker-labelled segments
   */
  async diarize(wavPath: string): Promise<DiarizationResult> {
    // Degraded-mode guard — return a single-speaker result covering the full file
    if (!this.diarizer || !this.sherpaOnnx) {
      console.warn(
        `[DiarizationService] Diarizer not available — returning single-speaker fallback for "${wavPath}"`
      )
      return this.singleSpeakerFallback()
    }

    // Verify the WAV file exists before processing
    const fileExists = await this.pathExists(wavPath)
    if (!fileExists) {
      throw new Error(`[DiarizationService] WAV file not found: "${wavPath}"`)
    }

    console.log(`[DiarizationService] Diarizing: ${wavPath} (auto-detect speakers)`)

    // ------------------------------------------------------------------
    // Read wave → process → extract segments
    // (§5.5 pipeline)
    // ------------------------------------------------------------------
    const wave = this.sherpaOnnx.readWave(wavPath, false) as {
      sampleRate: number
      samples: Float32Array
    }

    // sherpa-onnx WASM binding: process(samples) — numSpeakers is set via config
    const rawSegments: Array<{ start: number; end: number; speaker: number }> =
      this.diarizer.process(wave.samples)

    if (!rawSegments || rawSegments.length === 0) {
      console.warn(
        `[DiarizationService] No segments returned for "${wavPath}" — using single-speaker fallback`
      )
      return this.singleSpeakerFallback()
    }

    // Convert raw segments to typed DiarizationSegment[]
    const segments: DiarizationSegment[] = rawSegments.map((s) => ({
      speaker: s.speaker,
      startTime: s.start,
      endTime: s.end
    }))

    // Count unique speakers from returned segments
    const uniqueSpeakers = new Set(segments.map((s) => s.speaker))
    const detectedNumSpeakers = uniqueSpeakers.size

    console.log(
      `[DiarizationService] Done — ${segments.length} segment(s), ${detectedNumSpeakers} speaker(s)`
    )

    return { segments, numSpeakers: detectedNumSpeakers }
  }

  /**
   * Release the diarizer and reset internal state.
   * Safe to call even if initialize() was never called or failed. (§3.4)
   */
  dispose(): void {
    this.diarizer = null
    this.sherpaOnnx = null
    this.initialized = false
    console.log('[DiarizationService] Disposed')
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Returns true if the path exists (file or directory). */
  private async pathExists(p: string): Promise<boolean> {
    try {
      await fs.access(p)
      return true
    } catch {
      return false
    }
  }

  /**
   * Fallback result used when diarization is unavailable.
   * Returns a single speaker with a zero-duration segment, so the pipeline
   * can assign all transcription segments to a single speaker without crashing.
   */
  private singleSpeakerFallback(): DiarizationResult {
    return {
      segments: [{ speaker: 0, startTime: 0, endTime: 0 }],
      numSpeakers: 1
    }
  }
}
