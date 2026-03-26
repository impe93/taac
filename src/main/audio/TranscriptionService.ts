/**
 * TranscriptionService — sherpa-onnx Whisper integration
 *
 * Wraps the sherpa-onnx offline recognizer to provide local speech-to-text
 * transcription using Whisper ONNX models. Follows the project's native-module
 * patterns identical to node-llama-cpp:
 *
 * §3.3  initialize() is idempotent — safe to call multiple times
 * §3.4  dispose() tears down the recognizer and resets state
 * §3.5  type-only imports at top level; runtime dynamic import() inside initialize()
 * §3.7  all log lines are prefixed with [TranscriptionService]
 *
 * Reference: docs/NOTE_TAKER.md §5.1–§5.4, §11.3
 */

import { join } from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import type { TranscriptionResult, TranscriptionSegment } from './types'

// §3.5 — type-only import at top level; the actual module is loaded at runtime
// via dynamic import() inside initialize(), exactly like node-llama-cpp.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SherpaOnnxModule = any

export class TranscriptionService {
  /** Underlying sherpa-onnx offline recognizer instance */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private recognizer: any | null = null

  /** Cached sherpa-onnx module reference (set after dynamic import) */
  private sherpaOnnx: SherpaOnnxModule | null = null

  /** Guard flag for idempotent initialization (§3.3) */
  private initialized = false

  /**
   * Load the sherpa-onnx Whisper recognizer from the given model directory.
   *
   * The directory must contain at minimum:
   *   - encoder.int8.onnx  (or encoder.onnx)
   *   - decoder.int8.onnx  (or decoder.onnx)
   *   - tokens.txt
   *
   * If the directory is missing or any required file is absent, the service
   * starts in a degraded mode — transcribe() returns empty results instead of
   * throwing, so the pipeline can continue without crashing.
   *
   * @param modelDir  Absolute path to the whisper ONNX model directory
   */
  async initialize(modelDir: string): Promise<void> {
    // §3.3 — idempotent
    if (this.initialized) return

    console.log(`[TranscriptionService] Initializing — modelDir: ${modelDir}`)

    // ------------------------------------------------------------------
    // 1. Verify the model directory exists
    // ------------------------------------------------------------------
    const dirExists = await this.pathExists(modelDir)
    if (!dirExists) {
      console.warn(
        `[TranscriptionService] Model directory not found: "${modelDir}". ` +
          'Transcription will be unavailable until the model is downloaded.'
      )
      // Do NOT set this.initialized = true — allow re-initialization after download
      return
    }

    // ------------------------------------------------------------------
    // 2. Discover model files — match by suffix pattern to support all
    //    Whisper variants (e.g. base-encoder.int8.onnx, turbo-encoder.int8.onnx)
    // ------------------------------------------------------------------
    const entries = await fs.readdir(modelDir)
    const encoderPath = this.findByPattern(entries, modelDir, /encoder.*\.onnx$/i)
    const decoderPath = this.findByPattern(entries, modelDir, /decoder.*\.onnx$/i)
    const tokensPath = this.findByPattern(entries, modelDir, /tokens\.txt$/i)

    if (!encoderPath || !decoderPath || !tokensPath) {
      const missing: string[] = []
      if (!encoderPath) missing.push('encoder.onnx')
      if (!decoderPath) missing.push('decoder.onnx')
      if (!tokensPath) missing.push('tokens.txt')
      console.warn(
        `[TranscriptionService] Missing model file(s) in "${modelDir}": ${missing.join(', ')}. ` +
          'Transcription will be unavailable.'
      )
      return
    }

    console.log(`[TranscriptionService] Found model files:`)
    console.log(`  encoder: ${encoderPath}`)
    console.log(`  decoder: ${decoderPath}`)
    console.log(`  tokens:  ${tokensPath}`)

    // ------------------------------------------------------------------
    // 3. Dynamic import — §3.5 ESM pattern (same as node-llama-cpp)
    // ------------------------------------------------------------------
    const sherpaOnnxModule = await import('sherpa-onnx-node')
    // CJS module wrapped by dynamic import — exports are under .default
    const sherpaOnnx: SherpaOnnxModule = sherpaOnnxModule.default ?? sherpaOnnxModule
    this.sherpaOnnx = sherpaOnnx

    // ------------------------------------------------------------------
    // 4. Determine thread count — half the logical CPUs, clamped [2, 4]
    // ------------------------------------------------------------------
    const numThreads = Math.max(2, Math.min(4, Math.floor(os.cpus().length / 2)))
    console.log(`[TranscriptionService] Using ${numThreads} threads`)

    // ------------------------------------------------------------------
    // 5. Create the offline recognizer (§5.4 config layout)
    // ------------------------------------------------------------------
    this.recognizer = new sherpaOnnx.OfflineRecognizer({
      modelConfig: {
        whisper: {
          encoder: encoderPath,
          decoder: decoderPath,
          language: '', // empty string → auto-detect language
          task: 'transcribe'
        },
        tokens: tokensPath,
        numThreads,
        debug: 0
      }
    })

    this.initialized = true
    console.log('[TranscriptionService] Initialized successfully')
  }

  /**
   * Transcribe a 16 kHz mono WAV file.
   *
   * Returns empty results (rather than throwing) when the service is in
   * degraded mode (model not loaded), so the pipeline can continue.
   *
   * @param wavPath  Absolute path to the 16 kHz mono WAV file
   * @returns        TranscriptionResult with text, segments, and detected language
   */
  /** Whisper context window in seconds — audio is chunked at this boundary */
  private static readonly CHUNK_DURATION_SECS = 30
  /** Overlap between consecutive chunks to avoid cutting words at boundaries */
  private static readonly CHUNK_OVERLAP_SECS = 1

  async transcribe(wavPath: string): Promise<TranscriptionResult> {
    // Degraded-mode guard
    if (!this.recognizer || !this.sherpaOnnx) {
      console.warn(
        `[TranscriptionService] Recognizer not available — returning empty result for "${wavPath}"`
      )
      return { text: '', segments: [], detectedLanguage: 'en' }
    }

    // Verify the WAV file exists before processing
    const fileExists = await this.pathExists(wavPath)
    if (!fileExists) {
      throw new Error(`[TranscriptionService] WAV file not found: "${wavPath}"`)
    }

    console.log(`[TranscriptionService] Transcribing: ${wavPath}`)

    const wave = this.sherpaOnnx.readWave(wavPath, false) as {
      sampleRate: number
      samples: Float32Array
    }

    const chunkSamples = TranscriptionService.CHUNK_DURATION_SECS * wave.sampleRate
    const totalSamples = wave.samples.length
    const totalDurationSecs = totalSamples / wave.sampleRate

    // Short audio — single-pass (fast path)
    if (totalSamples <= chunkSamples) {
      console.log(
        `[TranscriptionService] Short audio (${totalDurationSecs.toFixed(1)}s) — single pass`
      )
      return this.transcribeSinglePass(wave.samples, wave.sampleRate)
    }

    // Long audio — chunked processing
    const overlapSamples = TranscriptionService.CHUNK_OVERLAP_SECS * wave.sampleRate
    const stepSamples = chunkSamples - overlapSamples
    const numChunks = Math.ceil((totalSamples - overlapSamples) / stepSamples)

    console.log(
      `[TranscriptionService] Long audio (${totalDurationSecs.toFixed(1)}s) — ` +
        `processing in ${numChunks} chunk(s) of ${TranscriptionService.CHUNK_DURATION_SECS}s`
    )

    const allSegments: TranscriptionSegment[] = []
    let fullText = ''
    let detectedLanguage = 'en'
    let offset = 0

    for (let chunkIdx = 0; offset < totalSamples; chunkIdx++) {
      const end = Math.min(offset + chunkSamples, totalSamples)
      const chunk = wave.samples.slice(offset, end)
      const chunkOffsetSecs = offset / wave.sampleRate
      const chunkDurationSecs = chunk.length / wave.sampleRate

      console.log(
        `[TranscriptionService] Chunk ${chunkIdx + 1}/${numChunks}: ` +
          `offset=${chunkOffsetSecs.toFixed(1)}s, duration=${chunkDurationSecs.toFixed(1)}s`
      )

      const chunkResult = this.transcribeChunk(chunk, wave.sampleRate)

      // Capture language from first chunk that detects one
      if (chunkIdx === 0 && chunkResult.detectedLanguage !== 'en') {
        detectedLanguage = chunkResult.detectedLanguage
      }

      // Build segments with offset-adjusted timestamps
      const segments = this.buildSegments(chunkResult.raw, chunkResult.text)

      // If no timestamps available, estimate from chunk position
      if (segments.length === 1 && segments[0].startTime === 0 && segments[0].endTime === 0) {
        segments[0].startTime = chunkOffsetSecs
        segments[0].endTime = chunkOffsetSecs + chunkDurationSecs
      } else {
        // Offset all timestamps by chunk position
        for (const seg of segments) {
          seg.startTime += chunkOffsetSecs
          seg.endTime += chunkOffsetSecs
        }
      }

      allSegments.push(...segments)
      if (chunkResult.text.trim()) {
        fullText += (fullText ? ' ' : '') + chunkResult.text.trim()
      }

      // Advance by step (chunk minus overlap)
      offset += stepSamples
      if (end >= totalSamples) break
    }

    console.log(
      `[TranscriptionService] Done — ${fullText.length} chars, ` +
        `${allSegments.length} segment(s), lang="${detectedLanguage}"`
    )

    return { text: fullText, segments: allSegments, detectedLanguage }
  }

  /**
   * Transcribe a single short audio pass (entire samples fit in Whisper context).
   */
  private transcribeSinglePass(samples: Float32Array, sampleRate: number): TranscriptionResult {
    const result = this.transcribeChunk(samples, sampleRate)
    const segments = this.buildSegments(result.raw, result.text)

    console.log(
      `[TranscriptionService] Done — ${result.text.length} chars, ` +
        `${segments.length} segment(s), lang="${result.detectedLanguage}"`
    )

    return { text: result.text, segments, detectedLanguage: result.detectedLanguage }
  }

  /**
   * Transcribe a single chunk of audio samples.
   * Returns the raw result object for segment building, plus extracted text and language.
   */
  private transcribeChunk(
    samples: Float32Array,
    sampleRate: number
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): { text: string; detectedLanguage: string; raw: Record<string, any> } {
    const stream = this.recognizer!.createStream()
    stream.acceptWaveform({ sampleRate, samples })
    this.recognizer!.decode(stream)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = this.recognizer!.getResult(stream) as Record<string, any>

    const text: string = typeof raw.text === 'string' ? raw.text : ''
    const detectedLanguage: string =
      typeof raw.lang === 'string' && raw.lang
        ? raw.lang
        : typeof raw.language === 'string' && raw.language
          ? raw.language
          : 'en'

    return { text, detectedLanguage, raw }
  }

  /**
   * Release the recognizer and reset internal state.
   * Safe to call even if initialize() was never called or failed. (§3.4)
   */
  dispose(): void {
    this.recognizer = null
    this.sherpaOnnx = null
    this.initialized = false
    console.log('[TranscriptionService] Disposed')
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
   * Find the first file in entries matching a regex pattern.
   * Returns the absolute path or null if no match.
   */
  private findByPattern(entries: string[], dir: string, pattern: RegExp): string | null {
    const match = entries.find((e) => pattern.test(e))
    return match ? join(dir, match) : null
  }

  /**
   * Convert the raw recognizer result into typed TranscriptionSegment array.
   *
   * sherpa-onnx may expose word/token-level timestamps via `result.timestamps`
   * (array of seconds, one per token) and `result.tokens` (array of strings).
   * When timestamps are unavailable, the whole text is returned as a single
   * segment with startTime=0, endTime=0.
   */
  private buildSegments(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    raw: Record<string, any>,
    fullText: string
  ): TranscriptionSegment[] {
    if (!fullText.trim()) return []

    const timestamps: number[] | undefined = Array.isArray(raw.timestamps)
      ? (raw.timestamps as number[])
      : undefined
    const tokens: string[] | undefined = Array.isArray(raw.tokens)
      ? (raw.tokens as string[])
      : undefined

    // No timestamp data → single segment covering the whole transcription
    if (!timestamps || !tokens || timestamps.length === 0 || timestamps.length !== tokens.length) {
      return [{ startTime: 0, endTime: 0, text: fullText.trim() }]
    }

    // Build sentence-level segments by grouping tokens at sentence boundaries
    const segments: TranscriptionSegment[] = []
    let segStart = timestamps[0]
    let currentText = ''

    for (let i = 0; i < tokens.length; i++) {
      currentText += tokens[i]
      const isLast = i === tokens.length - 1
      const isSentenceBoundary =
        isLast ||
        /[.!?]$/.test(tokens[i].trimEnd()) ||
        // also break on long pauses (gap > 1.5s between consecutive tokens)
        (i + 1 < timestamps.length && timestamps[i + 1] - timestamps[i] > 1.5)

      if (isSentenceBoundary) {
        const trimmed = currentText.trim()
        if (trimmed) {
          segments.push({ startTime: segStart, endTime: timestamps[i], text: trimmed })
        }
        if (i + 1 < timestamps.length) {
          segStart = timestamps[i + 1]
        }
        currentText = ''
      }
    }

    return segments
  }
}
