/**
 * WhisperService — unified whisper.cpp transcription (GPU + CPU)
 *
 * Single ASR engine for the meeting pipeline, wrapping @fugood/whisper.node
 * (whisper.cpp). Runs GPU-accelerated (Metal on macOS Apple Silicon, CUDA or
 * Vulkan on Windows/Linux) when available and falls back to CPU on the same
 * engine, so there is only one code path to maintain. Replaces the previous split
 * between WhisperGpuService (GGML/GPU) and TranscriptionService (sherpa-onnx/CPU).
 *
 * whisper.cpp handles arbitrarily long audio internally (sliding 30s windows),
 * so no manual chunking is needed. Language auto-detection is made robust to
 * leading silence via a windowed detection scan (see detectLanguage) — NOT via
 * the binding's Silero VAD context: whisper.cpp's VAD loader places the VAD
 * weights on the GPU device registered by the main context regardless of its
 * use_gpu flag, and the CPU-scheduled graph then hard-aborts (SIGABRT) on Metal.
 *
 * §3.3  initialize() is idempotent — safe to call multiple times
 * §3.4  dispose() releases the contexts and resets state
 * §3.5  type-only imports at top level; runtime dynamic import() inside initialize()
 * §3.7  all log lines are prefixed with [WhisperService]
 */

import fs from 'node:fs/promises'
import os from 'node:os'
import type { TranscriptionResult, TranscriptionSegment, WhisperVariant } from './types'
import { normalizeLanguageCode } from './language'

// §3.5 — type-only at top level; module loaded at runtime via dynamic import()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WhisperModule = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WhisperContext = any

export interface WhisperTranscribeOptions {
  /**
   * ISO 639-1 language to pin (e.g. 'it'). When omitted or empty the language
   * is auto-detected via a windowed scan over the first speech found. Pinning
   * avoids mis-detection and improves accuracy when the language is known.
   */
  language?: string
  /** Progress callback, 0–100, forwarded from whisper.cpp. */
  onProgress?: (percentage: number) => void
}

export class WhisperService {
  private context: WhisperContext | null = null
  private initialized = false

  /**
   * Load the whisper.cpp GGML model.
   *
   * @param modelPath  Absolute path to the GGML model file (e.g. ggml-large-v3-turbo.bin)
   * @param useGpu     Whether to enable GPU acceleration
   * @param variant    Native backend variant: 'default' (Metal on macOS / CPU),
   *                   'cuda' (NVIDIA) or 'vulkan' (AMD / Intel). The binding
   *                   falls back to the default build if the requested variant
   *                   package is not installed.
   */
  async initialize(
    modelPath: string,
    useGpu: boolean,
    variant: WhisperVariant = 'default'
  ): Promise<void> {
    if (this.initialized) return

    console.log(
      `[WhisperService] Initializing — model: ${modelPath}, useGpu: ${useGpu}, variant: ${variant}`
    )

    const exists = await this.pathExists(modelPath)
    if (!exists) {
      console.warn(
        `[WhisperService] Model file not found: "${modelPath}". Transcription will be unavailable.`
      )
      // Do NOT set initialized — allow re-init after the model is downloaded.
      return
    }

    // Dynamic import — §3.5 ESM pattern
    const whisperModule: WhisperModule = await import('@fugood/whisper.node')
    const mod = whisperModule.default ?? whisperModule
    const { initWhisper } = mod

    // Flash attention helps on Metal/CUDA; keep it off for Vulkan (spotty support).
    const useFlashAttn = useGpu && variant !== 'vulkan'

    // Try the GPU backend; on any GPU init failure (bad driver, missing runtime)
    // fall back to CPU so transcription still works — important across the varied
    // GPUs found on Windows/Linux machines.
    let effectiveUseGpu = useGpu
    try {
      this.context = await initWhisper({ filePath: modelPath, useGpu, useFlashAttn }, variant)
    } catch (err) {
      if (!useGpu) throw err
      console.warn(
        `[WhisperService] GPU init failed (variant: ${variant}) — falling back to CPU:`,
        err
      )
      effectiveUseGpu = false
      this.context = await initWhisper(
        { filePath: modelPath, useGpu: false, useFlashAttn: false },
        variant
      )
    }

    this.initialized = true
    console.log(
      `[WhisperService] Initialized — backend: ${effectiveUseGpu ? variant.toUpperCase() : 'CPU'}`
    )
  }

  /** Whether a usable whisper context is loaded. */
  isInitialized(): boolean {
    return this.context !== null
  }

  /**
   * Transcribe a 16 kHz mono WAV file.
   *
   * Returns an empty result (rather than throwing) when the service is in
   * degraded mode (model not loaded), so the pipeline can continue. The returned
   * `detectedLanguage` is a normalized ISO 639-1 code, or '' when it could not be
   * determined — callers are responsible for applying their own fallback (never
   * assume 'en').
   *
   * @param wavPath  Absolute path to the 16 kHz mono WAV file
   * @param options  Optional language pin and progress callback
   */
  async transcribe(
    wavPath: string,
    options?: WhisperTranscribeOptions
  ): Promise<TranscriptionResult> {
    if (!this.context) {
      console.warn(`[WhisperService] Context not available — empty result for "${wavPath}"`)
      return { text: '', segments: [], detectedLanguage: '' }
    }

    if (!(await this.pathExists(wavPath))) {
      throw new Error(`[WhisperService] WAV file not found: "${wavPath}"`)
    }

    // whisper.cpp benefits from more threads; clamp [2, 8].
    const maxThreads = Math.max(2, Math.min(8, Math.floor(os.cpus().length / 2)))

    // Resolve the language to use for decoding.
    const pinned = normalizeLanguageCode(options?.language)
    let language = pinned
    if (!language) {
      // Auto mode: scan for the first window that contains real speech and use
      // its language, so leading silence/music can't skew the detection.
      language = await this.detectLanguage(wavPath, maxThreads)
    }

    console.log(
      `[WhisperService] Transcribing: ${wavPath} — language: ${language || 'auto'}, threads: ${maxThreads}`
    )

    const { promise } = this.context.transcribeFile(wavPath, {
      maxThreads,
      // undefined → whisper.cpp auto-detect; a code → pin decoding to that language
      language: language || undefined,
      tokenTimestamps: true,
      onProgress:
        typeof options?.onProgress === 'function'
          ? (p: number): void => options.onProgress?.(Math.max(0, Math.min(100, p)))
          : undefined
    })

    const raw = await promise

    // whisper.cpp segment timestamps are in centiseconds (1/100 s) → seconds
    const segments: TranscriptionSegment[] = (raw.segments ?? [])
      .map(
        (s: { text: string; t0: number; t1: number }): TranscriptionSegment => ({
          text: (s.text ?? '').trim(),
          startTime: s.t0 / 100,
          endTime: s.t1 / 100
        })
      )
      .filter((s: TranscriptionSegment) => s.text.length > 0)

    // Prefer the pinned/resolved language; otherwise trust the model's own report.
    const detectedLanguage = language || normalizeLanguageCode(raw.language) || ''

    console.log(
      `[WhisperService] Done — ${(raw.result ?? '').length} chars, ` +
        `${segments.length} segment(s), lang="${detectedLanguage || 'unknown'}"`
    )

    return { text: raw.result ?? '', segments, detectedLanguage }
  }

  /** Language-detection window size and how much of the file to scan. */
  private static readonly DETECT_WINDOW_MS = 30_000
  private static readonly DETECT_MAX_WINDOWS = 4 // scan at most the first 2 minutes
  /** Minimum decoded text length before trusting a window's language. Filters
   *  out hallucinated fragments whisper emits on silence ("Thank you." etc). */
  private static readonly DETECT_MIN_TEXT_CHARS = 12

  /**
   * Windowed spoken-language detection.
   *
   * Whisper's built-in auto-detect samples only the first 30s of audio; when
   * those contain silence or music it tends to guess English — the root cause of
   * the "always English" bug. Instead we decode successive 30s windows until one
   * yields real text, and use that window's language. Any failure returns '' so
   * the caller falls back to its configured default / app locale.
   */
  private async detectLanguage(wavPath: string, maxThreads: number): Promise<string> {
    for (let i = 0; i < WhisperService.DETECT_MAX_WINDOWS; i++) {
      const offsetMs = i * WhisperService.DETECT_WINDOW_MS
      try {
        const { promise } = this.context.transcribeFile(wavPath, {
          maxThreads,
          offset: offsetMs,
          duration: WhisperService.DETECT_WINDOW_MS
        })
        const raw = await promise
        const text = ((raw.result as string) ?? '').trim()
        const lang = normalizeLanguageCode(raw.language)

        if (text.length >= WhisperService.DETECT_MIN_TEXT_CHARS && lang) {
          console.log(`[WhisperService] Detected language: ${lang} (window at ${offsetMs / 1000}s)`)
          return lang
        }
        // Empty window and past the end of the file → nothing left to scan.
        if (!text && i > 0) return ''
      } catch (err) {
        console.warn(`[WhisperService] Language detection window ${i} failed:`, err)
        return ''
      }
    }
    console.warn('[WhisperService] No speech found in scanned windows — language unknown')
    return ''
  }

  /**
   * Release the whisper context and reset internal state. (§3.4)
   */
  async dispose(): Promise<void> {
    if (this.context) {
      try {
        await this.context.release()
      } catch (err) {
        console.warn('[WhisperService] Error releasing context:', err)
      }
      this.context = null
    }
    this.initialized = false
    console.log('[WhisperService] Disposed')
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
