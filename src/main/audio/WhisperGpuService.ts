/**
 * WhisperGpuService — GPU-accelerated transcription via whisper.cpp
 *
 * Wraps @fugood/whisper.node to provide Metal-accelerated transcription on
 * macOS Apple Silicon (and CUDA on Windows/Linux when the cuda variant is used).
 * Uses GGML model format (.bin files) instead of the ONNX format used by
 * TranscriptionService.
 *
 * §3.3  initialize() is idempotent — safe to call multiple times
 * §3.4  dispose() releases the context and resets state
 * §3.5  type-only imports at top level; runtime dynamic import() inside initialize()
 * §3.7  all log lines are prefixed with [WhisperGpuService]
 *
 * Reference: docs/NOTE_TAKER.md §5.1–§5.4
 */

import fs from 'node:fs/promises'
import os from 'node:os'
import type { TranscriptionResult, TranscriptionSegment } from './types'

// §3.5 — type-only at top level; module loaded at runtime via dynamic import()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WhisperModule = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WhisperContext = any

export class WhisperGpuService {
  private context: WhisperContext | null = null
  private initialized = false

  /**
   * Load the whisper.cpp GGML model from the given file path.
   *
   * @param modelPath  Absolute path to the GGML model file (e.g. ggml-base.bin)
   * @param useGpu     Whether to enable GPU acceleration (Metal on macOS, CUDA on Windows/Linux)
   */
  async initialize(modelPath: string, useGpu: boolean): Promise<void> {
    if (this.initialized) return

    console.log(
      `[WhisperGpuService] Initializing — model: ${modelPath}, useGpu: ${useGpu}`
    )

    const exists = await this.pathExists(modelPath)
    if (!exists) {
      console.warn(
        `[WhisperGpuService] Model file not found: "${modelPath}". ` +
          'GPU transcription will be unavailable.'
      )
      return
    }

    // Dynamic import — §3.5 ESM pattern
    const whisperModule: WhisperModule = await import('@fugood/whisper.node')
    const { initWhisper } = whisperModule.default ?? whisperModule

    this.context = await initWhisper({
      filePath: modelPath,
      useGpu,
      useFlashAttn: useGpu // flash attention only beneficial with GPU
    })

    this.initialized = true
    console.log(
      `[WhisperGpuService] Initialized — GPU: ${useGpu ? 'enabled' : 'disabled'}`
    )
  }

  /**
   * Transcribe a 16 kHz mono WAV file.
   *
   * Returns empty results (rather than throwing) when the service is in
   * degraded mode (model not loaded), so the pipeline can continue.
   *
   * @param wavPath  Absolute path to the 16 kHz mono WAV file
   */
  async transcribe(wavPath: string): Promise<TranscriptionResult> {
    if (!this.context) {
      console.warn(
        `[WhisperGpuService] Context not available — returning empty result for "${wavPath}"`
      )
      return { text: '', segments: [], detectedLanguage: 'en' }
    }

    const fileExists = await this.pathExists(wavPath)
    if (!fileExists) {
      throw new Error(`[WhisperGpuService] WAV file not found: "${wavPath}"`)
    }

    console.log(`[WhisperGpuService] Transcribing: ${wavPath}`)

    // Use half of logical CPUs, clamped [2, 8] — whisper.cpp benefits from more threads
    const maxThreads = Math.max(2, Math.min(8, Math.floor(os.cpus().length / 2)))

    const { promise } = this.context.transcribeFile(wavPath, {
      maxThreads,
      // Omitting language → auto-detect (whisper.cpp default)
    })

    const raw = await promise

    // whisper.cpp timestamps are in centiseconds (1/100 s) → convert to seconds
    const segments: TranscriptionSegment[] = (raw.segments ?? [])
      .map(
        (s: { text: string; t0: number; t1: number }): TranscriptionSegment => ({
          text: s.text.trim(),
          startTime: s.t0 / 100,
          endTime: s.t1 / 100
        })
      )
      .filter((s: TranscriptionSegment) => s.text.length > 0)

    const detectedLanguage =
      typeof raw.language === 'string' && raw.language ? raw.language : 'en'

    console.log(
      `[WhisperGpuService] Done — ${(raw.result ?? '').length} chars, ` +
        `${segments.length} segment(s), lang="${detectedLanguage}"`
    )

    return {
      text: raw.result ?? '',
      segments,
      detectedLanguage
    }
  }

  /**
   * Whether the service has been successfully initialized.
   */
  isInitialized(): boolean {
    return this.initialized
  }

  /**
   * Release the whisper context and reset internal state. (§3.4)
   */
  async dispose(): Promise<void> {
    if (this.context) {
      try {
        await this.context.release()
      } catch (err) {
        console.warn('[WhisperGpuService] Error releasing context:', err)
      }
      this.context = null
    }
    this.initialized = false
    console.log('[WhisperGpuService] Disposed')
  }

  private async pathExists(p: string): Promise<boolean> {
    try {
      await fs.access(p)
      return true
    } catch {
      return false
    }
  }
}
