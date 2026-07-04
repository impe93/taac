/**
 * AsrSidecarManager — Python MLX sidecar for realtime transcription
 *
 * Spawns the Qwen3-ASR bridge (resources/asr/qwen3_asr_bridge.py) as a child
 * process and speaks the newline-delimited JSON protocol over stdio.
 * The bridge handles requests sequentially, so stdin acts as the FIFO queue:
 * responses are matched back to callers by request id.
 *
 * Lifetime is one recording session — spawned by RealtimeTranscriptionService
 * at recording start, disposed at stop (frees ~2.5-3GB before the summary LLM
 * loads, which keeps peak memory sane on 16GB machines).
 *
 * §3.3  initialize() is idempotent — safe to call multiple times
 * §3.4  dispose() terminates the child process and resets state
 * §3.7  all log lines are prefixed with [AsrSidecarManager]
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'

export interface AsrSidecarInitOptions {
  pythonPath: string
  bridgePath: string
  modelPath: string
}

export interface AsrTranscription {
  text: string
  /** Language name as reported by the model (e.g. "Italian"), '' when unknown */
  language: string
}

interface BridgeMessage {
  type: 'ready' | 'result' | 'error' | 'fatal'
  id?: string
  load_ms?: number
  text?: string
  language?: string
  message?: string
}

interface PendingRequest {
  resolve: (value: AsrTranscription) => void
  reject: (err: Error) => void
}

/** Cold model load + Metal warmup on a busy machine — generous by design */
const INIT_TIMEOUT_MS = 90_000
/** Grace period between the shutdown request and SIGKILL */
const SHUTDOWN_GRACE_MS = 3_000

export class AsrSidecarManager {
  private child: ChildProcessWithoutNullStreams | null = null
  private ready = false
  private disposing = false
  private nextRequestId = 0
  private pending = new Map<string, PendingRequest>()
  private exitCallbacks: Array<(code: number | null) => void> = []

  /**
   * Spawn the bridge and wait for the model to load (ready message).
   */
  async initialize(options: AsrSidecarInitOptions): Promise<void> {
    if (this.child) return

    console.log(`[AsrSidecarManager] Spawning sidecar: ${options.pythonPath} ${options.bridgePath}`)

    const child = spawn(options.pythonPath, ['-u', options.bridgePath], {
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.child = child
    this.disposing = false

    // Bridge logs arrive on stderr — forward them to the main process log
    createInterface({ input: child.stderr }).on('line', (line) => {
      console.log(`[AsrSidecarManager] ${line}`)
    })

    const readyPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Sidecar did not become ready within ${INIT_TIMEOUT_MS / 1000}s`))
        this.killNow()
      }, INIT_TIMEOUT_MS)

      // If the child dies before signalling ready (e.g. missing python deps),
      // reject instead of leaving the init promise pending forever.
      const onEarlyExit = (code: number | null): void => {
        clearTimeout(timeout)
        reject(new Error(`Sidecar exited during initialization (code ${code})`))
      }
      child.once('exit', onEarlyExit)

      createInterface({ input: child.stdout }).on('line', (line) => {
        let message: BridgeMessage
        try {
          message = JSON.parse(line)
        } catch {
          console.warn(`[AsrSidecarManager] Discarding malformed bridge line: ${line}`)
          return
        }

        switch (message.type) {
          case 'ready': {
            clearTimeout(timeout)
            child.off('exit', onEarlyExit)
            this.ready = true
            console.log(`[AsrSidecarManager] Sidecar ready (model load ${message.load_ms}ms)`)
            resolve()
            break
          }
          case 'result': {
            const pendingRequest = this.pending.get(message.id ?? '')
            if (pendingRequest) {
              this.pending.delete(message.id ?? '')
              pendingRequest.resolve({
                text: message.text ?? '',
                language: message.language ?? ''
              })
            }
            break
          }
          case 'error': {
            const pendingRequest = this.pending.get(message.id ?? '')
            if (pendingRequest) {
              this.pending.delete(message.id ?? '')
              pendingRequest.reject(new Error(message.message ?? 'Unknown sidecar error'))
            }
            break
          }
          case 'fatal': {
            console.error(`[AsrSidecarManager] Fatal sidecar error: ${message.message}`)
            clearTimeout(timeout)
            child.off('exit', onEarlyExit)
            reject(new Error(message.message ?? 'Fatal sidecar error'))
            break
          }
        }
      })

      child.on('exit', (code) => {
        const wasDisposing = this.disposing
        this.ready = false
        this.child = null

        // Reject all in-flight requests on any exit
        const err = new Error(`ASR sidecar exited (code ${code})`)
        for (const [, pendingRequest] of this.pending) {
          pendingRequest.reject(err)
        }
        this.pending.clear()

        if (!wasDisposing) {
          console.error(`[AsrSidecarManager] Sidecar exited unexpectedly with code ${code}`)
          for (const callback of this.exitCallbacks) {
            callback(code)
          }
        }
      })

      this.send({
        type: 'init',
        id: 'init',
        model_path: options.modelPath,
        warmup: true
      })
    })

    return readyPromise
  }

  isReady(): boolean {
    return this.ready && this.child !== null
  }

  /**
   * Register a callback for unexpected sidecar exits (not fired on dispose()).
   */
  onExit(callback: (code: number | null) => void): void {
    this.exitCallbacks.push(callback)
  }

  /**
   * Transcribe a PCM utterance (s16le, 16 kHz, mono).
   * Requests are answered in submission order by the bridge — stdin is the
   * FIFO queue, so utterances submitted while the model is still loading are
   * processed right after init instead of being dropped.
   *
   * @param pcm           Utterance samples
   * @param languageName  Optional canonical language hint (e.g. "Italian");
   *                      omit for per-utterance auto-detection
   */
  transcribe(pcm: Int16Array, languageName?: string): Promise<AsrTranscription> {
    if (!this.child || this.disposing) {
      return Promise.reject(new Error('ASR sidecar not running'))
    }

    const requestId = `u${this.nextRequestId++}`
    const pcmBase64 = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).toString('base64')

    return new Promise<AsrTranscription>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject })
      this.send({
        type: 'transcribe',
        id: requestId,
        pcm_b64: pcmBase64,
        language: languageName ?? null
      })
    })
  }

  /**
   * Gracefully shut down the sidecar; SIGKILL after a short grace period. (§3.4)
   */
  async dispose(): Promise<void> {
    const child = this.child
    if (!child) return

    console.log('[AsrSidecarManager] Disposing...')
    this.disposing = true
    this.ready = false

    await new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        console.warn('[AsrSidecarManager] Sidecar did not exit in time — killing')
        child.kill('SIGKILL')
      }, SHUTDOWN_GRACE_MS)

      child.once('exit', () => {
        clearTimeout(killTimer)
        resolve()
      })

      this.send({ type: 'shutdown' })
    })

    this.child = null
    console.log('[AsrSidecarManager] Disposed')
  }

  private send(message: Record<string, unknown>): void {
    if (!this.child || this.child.stdin.destroyed) return
    this.child.stdin.write(JSON.stringify(message) + '\n')
  }

  private killNow(): void {
    if (this.child) {
      this.disposing = true
      this.child.kill('SIGKILL')
      this.child = null
      this.ready = false
    }
  }
}
