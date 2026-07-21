/**
 * ProcessingUtilityManager — Main-thread Manager using Electron utilityProcess
 *
 * Replaces ProcessingWorkerManager to achieve true OS-level process isolation.
 * Worker threads (node:worker_threads) share CPU cores with the Electron main
 * process, causing UI freezes when CPU-intensive inference saturates all cores.
 * utilityProcess.fork() spawns a separate OS process with independent CPU
 * scheduling, so the main process event loop stays responsive.
 *
 * Public API is identical to ProcessingWorkerManager — drop-in replacement.
 *
 * §3.3  initialize() is idempotent — safe to call multiple times
 * §3.4  dispose() terminates the child process and resets state
 * §3.7  all log lines are prefixed with [ProcessingUtilityManager]
 */

import { utilityProcess, type UtilityProcess } from 'electron'
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

export class ProcessingUtilityManager {
  private child: UtilityProcess | null = null
  private initialized = false

  // Pending Promise callbacks keyed by taskId
  private pendingTranscriptions = new Map<string, PendingTask<TranscriptionResult>>()
  private pendingDiarizations = new Map<string, PendingTask<DiarizationResult>>()

  /**
   * Fork the utility process and wait for it to be ready.
   *
   * @param config  Worker initialization configuration (model paths, GPU flags)
   */
  async initialize(config: WorkerInitConfig): Promise<void> {
    if (this.initialized) return

    console.log('[ProcessingUtilityManager] Forking utility process...')

    return new Promise((resolve, reject) => {
      const workerPath = join(__dirname, 'processingWorker.js')

      const child = utilityProcess.fork(workerPath, [], {
        serviceName: 'taac-processing',
        stdio: 'inherit'
      })
      this.child = child

      // If the child dies before signalling ready (e.g. a native abort in a
      // model init), reject instead of leaving the init promise pending forever.
      const onEarlyExit = (code: number): void => {
        reject(
          new Error(
            `Utility process crashed during initialization (exit code ${code}). ` +
              'Check the audio model files and logs.'
          )
        )
      }
      child.once('exit', onEarlyExit)

      // One-shot initialization listener
      const onInit = (msg: WorkerOutMessage): void => {
        if (msg.type === 'ready') {
          child.off('message', onInit)
          child.off('exit', onEarlyExit)
          this.initialized = true
          console.log('[ProcessingUtilityManager] Utility process ready')
          resolve()
        } else if (msg.type === 'init-error') {
          child.off('message', onInit)
          child.off('exit', onEarlyExit)
          console.error('[ProcessingUtilityManager] Init error:', msg.error)
          reject(new Error(msg.error))
        }
      }

      child.on('message', onInit)

      // Ongoing message handler for task results and progress
      child.on('message', (msg: WorkerOutMessage) => {
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

      child.on('exit', (code) => {
        if (code !== 0) {
          console.error(`[ProcessingUtilityManager] Process exited with code ${code}`)
        }
        // Reject all pending tasks on unexpected exit
        const err = new Error(`Utility process exited with code ${code}`)
        for (const [, pending] of this.pendingTranscriptions) {
          pending.reject(err)
        }
        for (const [, pending] of this.pendingDiarizations) {
          pending.reject(err)
        }
        this.pendingTranscriptions.clear()
        this.pendingDiarizations.clear()
        this.child = null
        this.initialized = false
      })

      child.postMessage({ type: 'init', config })
    })
  }

  /**
   * Transcribe a WAV file in the utility process.
   *
   * @param wavPath     Absolute path to the 16 kHz mono WAV file
   * @param language    Optional ISO 639-1 language to pin (omit/'' → auto-detect)
   * @param onProgress  Optional callback for progress events
   */
  transcribe(
    wavPath: string,
    language?: string,
    onProgress?: ProgressCallback
  ): Promise<TranscriptionResult> {
    if (!this.child || !this.initialized) {
      return Promise.reject(new Error('Utility process not initialized'))
    }

    const taskId = randomUUID()

    return new Promise<TranscriptionResult>((resolve, reject) => {
      this.pendingTranscriptions.set(taskId, { resolve, reject, onProgress })
      this.child!.postMessage({ type: 'transcribe', wavPath, taskId, language })
    })
  }

  /**
   * Diarize a WAV file in the utility process.
   *
   * @param wavPath     Absolute path to the 16 kHz mono WAV file
   * @param onProgress  Optional callback for progress events
   */
  diarize(wavPath: string, onProgress?: ProgressCallback): Promise<DiarizationResult> {
    if (!this.child || !this.initialized) {
      return Promise.reject(new Error('Utility process not initialized'))
    }

    const taskId = randomUUID()

    return new Promise<DiarizationResult>((resolve, reject) => {
      this.pendingDiarizations.set(taskId, { resolve, reject, onProgress })
      this.child!.postMessage({ type: 'diarize', wavPath, taskId })
    })
  }

  /**
   * Terminate the utility process and reset state. (§3.4)
   */
  async dispose(): Promise<void> {
    console.log('[ProcessingUtilityManager] Disposing...')

    // Reject all pending tasks before terminating
    const err = new Error('Utility process disposed')
    for (const [, pending] of this.pendingTranscriptions) {
      pending.reject(err)
    }
    for (const [, pending] of this.pendingDiarizations) {
      pending.reject(err)
    }
    this.pendingTranscriptions.clear()
    this.pendingDiarizations.clear()

    if (this.child) {
      this.child.kill()
      this.child = null
    }

    this.initialized = false
    console.log('[ProcessingUtilityManager] Disposed')
  }
}
