/**
 * processingWorker — Worker Thread for Meeting Audio Pipeline
 *
 * Runs transcription and diarization off the Electron main thread to prevent
 * UI freezes during CPU/GPU-intensive inference.
 *
 * Transcription uses a single engine — WhisperService (whisper.cpp via
 * @fugood/whisper.node) — which runs GPU-accelerated (Metal / CUDA) when
 * available and on CPU otherwise. Diarization uses sherpa-onnx-node (CPU).
 *
 * Message protocol: see WorkerInMessage / WorkerOutMessage below.
 */

import { parentPort } from 'node:worker_threads'
import type { TranscriptionResult, DiarizationResult, WhisperVariant } from './types'

// ─── Message protocol ────────────────────────────────────────────────────────

export interface WorkerInitConfig {
  /** Absolute path to the GGML whisper model file (e.g. ggml-large-v3-turbo.bin) */
  whisperModelPath?: string
  /** Enable GPU acceleration (Metal on macOS, CUDA/Vulkan on Windows/Linux) */
  useGpu: boolean
  /** Native whisper.cpp backend variant to load ('default' | 'cuda' | 'vulkan') */
  whisperVariant?: WhisperVariant
  /** Absolute path to the pyannote segmentation ONNX model */
  segmentationModelPath: string
  /** Absolute path to the speaker embedding ONNX model */
  embeddingModelPath: string
}

type WorkerInMessage =
  | { type: 'init'; config: WorkerInitConfig }
  | { type: 'transcribe'; wavPath: string; taskId: string; language?: string }
  | { type: 'diarize'; wavPath: string; taskId: string }

export type WorkerOutMessage =
  | { type: 'ready' }
  | { type: 'init-error'; error: string }
  | { type: 'transcription-result'; taskId: string; result: TranscriptionResult }
  | { type: 'diarization-result'; taskId: string; result: DiarizationResult }
  | { type: 'task-error'; taskId: string; error: string }
  | { type: 'progress'; taskId: string; stage: string; percentage: number }

// ─── Dual-mode message port ──────────────────────────────────────────────────
// Supports both node:worker_threads (Worker) and Electron utilityProcess.
// Worker threads: parentPort is non-null, messages arrive directly.
// Utility process: parentPort is null, messages arrive on process.parentPort
// wrapped in { data: ... }.

interface IMessagePort {
  onMessage(handler: (msg: WorkerInMessage) => void): void
  postMessage(msg: WorkerOutMessage): void
}

// Access Electron's process.parentPort (only exists in utility processes)
const electronParentPort = (process as NodeJS.Process & { parentPort?: Electron.ParentPort })
  .parentPort

function createPort(): IMessagePort {
  if (parentPort) {
    const wp = parentPort
    return {
      onMessage: (handler): void => {
        wp.on('message', handler)
      },
      postMessage: (msg): void => {
        wp.postMessage(msg)
      }
    }
  }

  if (electronParentPort) {
    const ep = electronParentPort
    return {
      onMessage: (handler): void => {
        ep.on('message', (e) => handler(e.data as WorkerInMessage))
      },
      postMessage: (msg): void => {
        ep.postMessage(msg)
      }
    }
  }

  throw new Error(
    '[Worker] No message port available — must run as worker thread or utility process'
  )
}

const port = createPort()

// ─── Worker state ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let whisperService: any | null = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let diarizationService: any | null = null

function send(msg: WorkerOutMessage): void {
  port.postMessage(msg)
}

// A whisper.cpp context is NOT safe for concurrent use: two overlapping
// transcribeFile calls on the same context hang inside the native code with no
// error (seen in remote mode, where mic + system tracks are requested together).
// All whisper work is therefore serialized through this promise chain.
// Diarization needs no queue: it uses a separate sherpa-onnx context and its
// native process() call is synchronous.
let whisperQueue: Promise<unknown> = Promise.resolve()

function enqueueWhisperTask<T>(task: () => Promise<T>): Promise<T> {
  const run = whisperQueue.then(task, task)
  // Keep the chain alive regardless of individual task outcomes.
  whisperQueue = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

// ─── Initialization ───────────────────────────────────────────────────────────

async function handleInit(config: WorkerInitConfig): Promise<void> {
  try {
    const { WhisperService } = await import('./WhisperService')
    const { DiarizationService } = await import('./DiarizationService')

    // Transcription: single whisper.cpp engine (GPU when available, else CPU)
    if (config.whisperModelPath) {
      const svc = new WhisperService()
      await svc.initialize(config.whisperModelPath, config.useGpu, config.whisperVariant)
      if (svc.isInitialized()) {
        whisperService = svc
        const backend = config.useGpu ? (config.whisperVariant ?? 'default').toUpperCase() : 'CPU'
        console.log(`[Worker] Transcription: whisper.cpp (${backend})`)
      } else {
        console.warn('[Worker] Whisper model not available — transcription disabled')
      }
    } else {
      console.warn('[Worker] No whisper model path provided — transcription disabled')
    }

    // Diarization always uses sherpa-onnx (CPU)
    const diarSvc = new DiarizationService()
    await diarSvc.initialize(config.segmentationModelPath, config.embeddingModelPath)
    diarizationService = diarSvc
    console.log('[Worker] Diarization: CPU (sherpa-onnx)')

    send({ type: 'ready' })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Worker] Init error:', msg)
    send({ type: 'init-error', error: msg })
  }
}

// ─── Task handlers ────────────────────────────────────────────────────────────

async function handleTranscribe(wavPath: string, taskId: string, language?: string): Promise<void> {
  try {
    send({ type: 'progress', taskId, stage: 'transcribing', percentage: 0 })

    let result: TranscriptionResult

    if (whisperService) {
      result = await enqueueWhisperTask(() =>
        whisperService.transcribe(wavPath, {
          language,
          onProgress: (percentage: number): void =>
            send({ type: 'progress', taskId, stage: 'transcribing', percentage })
        })
      )
    } else {
      console.warn('[Worker] No transcription service available — returning empty result')
      result = { text: '', segments: [], detectedLanguage: '' }
    }

    send({ type: 'progress', taskId, stage: 'transcribing', percentage: 100 })
    send({ type: 'transcription-result', taskId, result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[Worker] Transcription error for taskId=${taskId}:`, msg)
    send({ type: 'task-error', taskId, error: msg })
  }
}

async function handleDiarize(wavPath: string, taskId: string): Promise<void> {
  try {
    send({ type: 'progress', taskId, stage: 'diarizing', percentage: 0 })

    let result: DiarizationResult

    if (diarizationService) {
      result = await diarizationService.diarize(wavPath)
    } else {
      console.warn('[Worker] No diarization service — returning single-speaker fallback')
      result = { segments: [{ speaker: 0, startTime: 0, endTime: 0 }], numSpeakers: 1 }
    }

    send({ type: 'progress', taskId, stage: 'diarizing', percentage: 100 })
    send({ type: 'diarization-result', taskId, result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[Worker] Diarization error for taskId=${taskId}:`, msg)
    send({ type: 'task-error', taskId, error: msg })
  }
}

// ─── Message dispatcher ───────────────────────────────────────────────────────

port.onMessage((msg: WorkerInMessage) => {
  switch (msg.type) {
    case 'init':
      handleInit(msg.config)
      break
    case 'transcribe':
      handleTranscribe(msg.wavPath, msg.taskId, msg.language)
      break
    case 'diarize':
      handleDiarize(msg.wavPath, msg.taskId)
      break
  }
})
