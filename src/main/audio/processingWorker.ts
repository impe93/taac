/**
 * processingWorker — Worker Thread for Meeting Audio Pipeline
 *
 * Runs transcription and diarization off the Electron main thread to prevent
 * UI freezes during CPU/GPU-intensive inference.
 *
 * Transcription path selection:
 *   - GPU (hasMetal on macOS arm64, hasCuda on Windows/Linux): WhisperGpuService
 *   - CPU fallback: TranscriptionService (sherpa-onnx-node ONNX)
 *
 * Diarization always uses sherpa-onnx-node (CPU). Models are small (~15MB)
 * and fast on Apple Silicon CPU.
 *
 * Message protocol: see WorkerInMessage / WorkerOutMessage below.
 */

import { parentPort } from 'node:worker_threads'
import type { TranscriptionResult, DiarizationResult } from './types'

// ─── Message protocol ────────────────────────────────────────────────────────

export interface WorkerInitConfig {
  /** 'gpu' uses WhisperGpuService + GGML model; 'cpu' uses TranscriptionService + ONNX models */
  transcriptionMode: 'gpu' | 'cpu'
  /** GPU path: absolute path to the single GGML model file (e.g. ggml-base.bin) */
  whisperModelPath?: string
  /** CPU path: absolute path to the directory containing ONNX model files */
  whisperModelDir?: string
  /** Whether Metal GPU is available (macOS Apple Silicon) */
  hasMetal: boolean
  /** Whether CUDA GPU is available (Windows / Linux) */
  hasCuda: boolean
  /** Absolute path to the pyannote segmentation ONNX model */
  segmentationModelPath: string
  /** Absolute path to the 3dspeaker embedding ONNX model */
  embeddingModelPath: string
}

type WorkerInMessage =
  | { type: 'init'; config: WorkerInitConfig }
  | { type: 'transcribe'; wavPath: string; taskId: string }
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
let gpuService: any | null = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cpuService: any | null = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let diarizationService: any | null = null
let activeMode: 'gpu' | 'cpu' | null = null

function send(msg: WorkerOutMessage): void {
  port.postMessage(msg)
}

// ─── Initialization ───────────────────────────────────────────────────────────

async function handleInit(config: WorkerInitConfig): Promise<void> {
  try {
    const { WhisperGpuService } = await import('./WhisperGpuService')
    const { TranscriptionService } = await import('./TranscriptionService')
    const { DiarizationService } = await import('./DiarizationService')

    activeMode = config.transcriptionMode

    if (config.transcriptionMode === 'gpu' && config.whisperModelPath) {
      // GPU path: use whisper.cpp with Metal (macOS) or CUDA (Windows/Linux)
      const useGpu = config.hasMetal || config.hasCuda
      const svc = new WhisperGpuService()
      await svc.initialize(config.whisperModelPath, useGpu)

      if (svc.isInitialized()) {
        gpuService = svc
        console.log('[Worker] Transcription: GPU (whisper.cpp)')
      } else {
        // GPU init failed — fall back to CPU ONNX path if a modelDir is available
        console.warn('[Worker] GPU service init failed — attempting CPU fallback')
        if (config.whisperModelDir) {
          const cpuSvc = new TranscriptionService()
          await cpuSvc.initialize(config.whisperModelDir)
          cpuService = cpuSvc
          activeMode = 'cpu'
          console.log('[Worker] Transcription: CPU fallback (sherpa-onnx)')
        }
      }
    } else if (config.whisperModelDir) {
      // CPU path: use sherpa-onnx ONNX models
      const svc = new TranscriptionService()
      await svc.initialize(config.whisperModelDir)
      cpuService = svc
      console.log('[Worker] Transcription: CPU (sherpa-onnx)')
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

async function handleTranscribe(wavPath: string, taskId: string): Promise<void> {
  try {
    send({ type: 'progress', taskId, stage: 'transcribing', percentage: 0 })

    let result: TranscriptionResult

    if (activeMode === 'gpu' && gpuService) {
      result = await gpuService.transcribe(wavPath)
    } else if (cpuService) {
      result = await cpuService.transcribe(wavPath)
    } else {
      // No transcription service available — return empty result
      console.warn('[Worker] No transcription service available — returning empty result')
      result = { text: '', segments: [], detectedLanguage: 'en' }
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
      handleTranscribe(msg.wavPath, msg.taskId)
      break
    case 'diarize':
      handleDiarize(msg.wavPath, msg.taskId)
      break
  }
})
