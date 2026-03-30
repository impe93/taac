/**
 * ProcessingWorkerManager — Main-thread Manager for the Processing Worker
 *
 * Creates and manages the processing worker thread lifecycle, providing a
 * Promise-based API for transcription and diarization that runs off the
 * Electron main thread.
 *
 * §3.3  initialize() is idempotent — safe to call multiple times
 * §3.4  dispose() terminates the worker and resets state
 * §3.7  all log lines are prefixed with [ProcessingWorkerManager]
 */

import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { TranscriptionResult, DiarizationResult } from './types'
import type { WorkerInitConfig, WorkerOutMessage } from './processingWorker'

export type ProgressCallback = (stage: string, percentage: number) => void

interface PendingTask<T> {
  resolve: (value: T) => void
  reject: (err: Error) => void
  onProgress?: ProgressCallback
}

export class ProcessingWorkerManager {
  private worker: Worker | null = null
  private initialized = false

  // Pending Promise callbacks keyed by taskId
  private pendingTranscriptions = new Map<string, PendingTask<TranscriptionResult>>()
  private pendingDiarizations = new Map<string, PendingTask<DiarizationResult>>()

  /**
   * Start the worker thread and wait for it to be ready.
   *
   * @param config  Worker initialization configuration (model paths, GPU flags)
   */
  async initialize(config: WorkerInitConfig): Promise<void> {
    if (this.initialized) return

    console.log('[ProcessingWorkerManager] Starting worker...')

    return new Promise((resolve, reject) => {
      // In development and production, electron-vite emits processingWorker.js
      // alongside index.js in the same output directory (__dirname)
      const workerPath = join(__dirname, 'processingWorker.js')

      const worker = new Worker(workerPath)
      this.worker = worker

      // One-shot initialization listener
      const onInit = (msg: WorkerOutMessage): void => {
        if (msg.type === 'ready') {
          worker.off('message', onInit)
          this.initialized = true
          console.log('[ProcessingWorkerManager] Worker ready')
          resolve()
        } else if (msg.type === 'init-error') {
          worker.off('message', onInit)
          console.error('[ProcessingWorkerManager] Worker init error:', msg.error)
          reject(new Error(msg.error))
        }
      }

      worker.on('message', onInit)

      // Ongoing message handler for task results and progress
      worker.on('message', (msg: WorkerOutMessage) => {
        switch (msg.type) {
          case 'transcription-result': {
            const pending = this.pendingTranscriptions.get(msg.taskId)
            if (pending) {
              this.pendingTranscriptions.delete(msg.taskId)
              pending.resolve(msg.result)
            }
            break
          }
          case 'diarization-result': {
            const pending = this.pendingDiarizations.get(msg.taskId)
            if (pending) {
              this.pendingDiarizations.delete(msg.taskId)
              pending.resolve(msg.result)
            }
            break
          }
          case 'task-error': {
            // Resolve both maps — the taskId belongs to exactly one
            const transcPending = this.pendingTranscriptions.get(msg.taskId)
            if (transcPending) {
              this.pendingTranscriptions.delete(msg.taskId)
              transcPending.reject(new Error(msg.error))
            }
            const diarPending = this.pendingDiarizations.get(msg.taskId)
            if (diarPending) {
              this.pendingDiarizations.delete(msg.taskId)
              diarPending.reject(new Error(msg.error))
            }
            break
          }
          case 'progress': {
            const transcPending = this.pendingTranscriptions.get(msg.taskId)
            transcPending?.onProgress?.(msg.stage, msg.percentage)
            const diarPending = this.pendingDiarizations.get(msg.taskId)
            diarPending?.onProgress?.(msg.stage, msg.percentage)
            break
          }
        }
      })

      worker.on('error', (err) => {
        console.error('[ProcessingWorkerManager] Worker error:', err.message)
        // Reject all pending tasks
        for (const [, pending] of this.pendingTranscriptions) {
          pending.reject(err)
        }
        for (const [, pending] of this.pendingDiarizations) {
          pending.reject(err)
        }
        this.pendingTranscriptions.clear()
        this.pendingDiarizations.clear()
      })

      worker.on('exit', (code) => {
        if (code !== 0) {
          console.error(`[ProcessingWorkerManager] Worker exited with code ${code}`)
        }
        this.worker = null
        this.initialized = false
      })

      worker.postMessage({ type: 'init', config })
    })
  }

  /**
   * Transcribe a WAV file in the worker thread.
   *
   * @param wavPath     Absolute path to the 16 kHz mono WAV file
   * @param onProgress  Optional callback for progress events
   */
  transcribe(wavPath: string, onProgress?: ProgressCallback): Promise<TranscriptionResult> {
    if (!this.worker || !this.initialized) {
      return Promise.reject(new Error('Worker not initialized'))
    }

    const taskId = randomUUID()

    return new Promise<TranscriptionResult>((resolve, reject) => {
      this.pendingTranscriptions.set(taskId, { resolve, reject, onProgress })
      this.worker!.postMessage({ type: 'transcribe', wavPath, taskId })
    })
  }

  /**
   * Diarize a WAV file in the worker thread.
   *
   * @param wavPath     Absolute path to the 16 kHz mono WAV file
   * @param onProgress  Optional callback for progress events
   */
  diarize(wavPath: string, onProgress?: ProgressCallback): Promise<DiarizationResult> {
    if (!this.worker || !this.initialized) {
      return Promise.reject(new Error('Worker not initialized'))
    }

    const taskId = randomUUID()

    return new Promise<DiarizationResult>((resolve, reject) => {
      this.pendingDiarizations.set(taskId, { resolve, reject, onProgress })
      this.worker!.postMessage({ type: 'diarize', wavPath, taskId })
    })
  }

  /**
   * Terminate the worker and reset state. (§3.4)
   */
  async dispose(): Promise<void> {
    console.log('[ProcessingWorkerManager] Disposing...')

    // Reject all pending tasks before terminating
    const err = new Error('Worker disposed')
    for (const [, pending] of this.pendingTranscriptions) {
      pending.reject(err)
    }
    for (const [, pending] of this.pendingDiarizations) {
      pending.reject(err)
    }
    this.pendingTranscriptions.clear()
    this.pendingDiarizations.clear()

    if (this.worker) {
      await this.worker.terminate()
      this.worker = null
    }

    this.initialized = false
    console.log('[ProcessingWorkerManager] Disposed')
  }
}
