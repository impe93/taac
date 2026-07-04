/**
 * VadSegmenter — per-track Silero VAD wrapper (sherpa-onnx)
 *
 * Segments a live PCM stream into speech utterances. Fed with s16le 16 kHz
 * mono chunks from the renderer's AudioWorklet tap; emits finalized utterances
 * (Float32 samples + absolute start sample index) via the onUtterance callback.
 *
 * The start index counts only samples actually fed — the renderer gates PCM
 * during pause — so `startSample / 16000` lands on the same pause-compressed
 * timeline as the WAV files used by diarization.
 *
 * §3.3  initialize() is idempotent — safe to call multiple times
 * §3.4  dispose() releases the native detector
 * §3.5  type-only imports at top level; runtime dynamic import() in initialize()
 * §3.7  all log lines are prefixed with [VadSegmenter]
 */

export const VAD_SAMPLE_RATE = 16000

export interface VadUtterance {
  /** Absolute start sample index on the fed (pause-compressed) stream */
  startSample: number
  /** Utterance samples as Float32 in [-1, 1] */
  samples: Float32Array
}

/** Structural interface of sherpa-onnx-node's Vad — injectable for tests */
export interface SileroVadLike {
  acceptWaveform(samples: Float32Array): void
  isEmpty(): boolean
  front(enableExternalBuffer?: boolean): { start: number; samples: Float32Array }
  pop(): void
  flush(): void
  clear(): void
}

export interface VadSegmenterOptions {
  vadModelPath: string
  onUtterance: (utterance: VadUtterance) => void
  /** Test seam: bypasses the sherpa-onnx dynamic import when provided */
  vadInstance?: SileroVadLike
}

/**
 * Silero tuning for meeting speech:
 * - 0.6s silence closes an utterance (natural sentence pauses)
 * - utterances shorter than 0.25s are discarded (clicks, breaths)
 * - 28s cap force-splits monologues so live latency stays bounded
 */
const SILERO_CONFIG = {
  threshold: 0.5,
  minSilenceDuration: 0.6,
  minSpeechDuration: 0.25,
  maxSpeechDuration: 28,
  windowSize: 512
}

const VAD_BUFFER_SECONDS = 60

/**
 * Silero triggers a few hundred ms into speech, clipping the attack of the
 * first word ("Buongiorno" → "giorno"). Each utterance is therefore prefixed
 * with up to 0.3s of audio taken from a local ring buffer of recent samples
 * (never overlapping the previous utterance).
 */
const PRE_PAD_SAMPLES = Math.round(0.3 * VAD_SAMPLE_RATE)

/**
 * Ring capacity must cover the longest utterance (28s) plus closing silence
 * and padding, because the pre-pad samples precede the utterance start.
 */
const RING_SAMPLES = 32 * VAD_SAMPLE_RATE

export class VadSegmenter {
  private vad: SileroVadLike | null = null
  private onUtterance: (utterance: VadUtterance) => void
  private options: VadSegmenterOptions

  /** Recent raw samples, indexed by absolute sample position modulo capacity */
  private ring = new Float32Array(RING_SAMPLES)
  /** Total samples fed so far (absolute stream position) */
  private totalFed = 0
  /** Absolute end of the last emitted utterance — padding never crosses it */
  private lastUtteranceEnd = 0

  constructor(options: VadSegmenterOptions) {
    this.options = options
    this.onUtterance = options.onUtterance
  }

  async initialize(): Promise<void> {
    if (this.vad) return

    if (this.options.vadInstance) {
      this.vad = this.options.vadInstance
      return
    }

    // §3.5 — sherpa-onnx-node is a native module, loaded at runtime
    const sherpaOnnxModule = await import('sherpa-onnx-node')
    const sherpa = sherpaOnnxModule.default ?? sherpaOnnxModule

    this.vad = new sherpa.Vad(
      {
        sileroVad: {
          model: this.options.vadModelPath,
          ...SILERO_CONFIG
        },
        sampleRate: VAD_SAMPLE_RATE,
        numThreads: 1,
        provider: 'cpu',
        debug: false
      },
      VAD_BUFFER_SECONDS
    )

    console.log(`[VadSegmenter] Initialized with ${this.options.vadModelPath}`)
  }

  /**
   * Feed a PCM chunk (s16le samples) and drain any utterances the detector
   * finalized. Utterance samples are copied out before pop() releases them.
   */
  accept(pcm: Int16Array): void {
    if (!this.vad) return

    const float32 = new Float32Array(pcm.length)
    for (let i = 0; i < pcm.length; i++) {
      float32[i] = pcm[i] / 32768
    }

    // Keep the raw stream in the ring so utterances can be pre-padded
    for (let i = 0; i < float32.length; i++) {
      this.ring[(this.totalFed + i) % RING_SAMPLES] = float32[i]
    }
    this.totalFed += float32.length

    this.vad.acceptWaveform(float32)
    this.drain()
  }

  /**
   * End of recording: flush the detector's pending buffer so a trailing
   * utterance without closing silence is still emitted.
   */
  flush(): void {
    if (!this.vad) return
    this.vad.flush()
    this.drain()
  }

  dispose(): void {
    if (this.vad) {
      this.vad.clear()
      this.vad = null
    }
  }

  private drain(): void {
    if (!this.vad) return
    while (!this.vad.isEmpty()) {
      // enableExternalBuffer MUST be false: Electron's V8 memory cage forbids
      // N-API external buffers ("External buffers are not allowed") — same
      // reason DiarizationService calls readWave(path, false).
      const segment = this.vad.front(false)
      const utterance = this.withPrePad(segment.start, segment.samples)
      this.lastUtteranceEnd = segment.start + segment.samples.length
      this.onUtterance(utterance)
      this.vad.pop()
    }
  }

  /**
   * Prefix an utterance with up to PRE_PAD_SAMPLES of preceding audio from the
   * ring buffer. Also copies the native samples — the buffer returned by
   * front() is invalidated by pop().
   */
  private withPrePad(startSample: number, samples: Float32Array): VadUtterance {
    const oldestAvailable = Math.max(0, this.totalFed - RING_SAMPLES)
    const padStart = Math.max(startSample - PRE_PAD_SAMPLES, this.lastUtteranceEnd, oldestAvailable)
    const padLength = Math.max(0, startSample - padStart)

    const combined = new Float32Array(padLength + samples.length)
    for (let i = 0; i < padLength; i++) {
      combined[i] = this.ring[(padStart + i) % RING_SAMPLES]
    }
    combined.set(samples, padLength)

    return { startSample: padStart, samples: combined }
  }
}
