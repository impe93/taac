/**
 * LlmSidecarManager — Python MLX sidecar for LLM text generation
 *
 * Spawns the mlx-lm bridge (resources/llm/mlx_llm_bridge.py) as a child process
 * and speaks the newline-delimited JSON protocol over stdio. Unlike the ASR
 * sidecar, generation is STREAMING: a single `generate` request produces many
 * `chunk` messages followed by one `done`. A background reader thread in the
 * bridge lets `abort` requests interrupt an in-flight generation.
 *
 * Lifetime mirrors the AIManager chat-model lifecycle: spawned on first use,
 * disposed on idle/unload. On Apple Silicon the summary path disposes the ASR
 * sidecar BEFORE this one loads, so peak memory stays ~one MLX model at a time.
 *
 * §3.3  initialize() is idempotent — safe to call multiple times
 * §3.4  dispose() terminates the child process and resets state
 * §3.7  all log lines are prefixed with [LlmSidecarManager]
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'

export interface LlmSidecarInitOptions {
  pythonPath: string
  bridgePath: string
  modelPath: string
}

/** A single JSON tool call parsed from the model output (Qwen3 `<tool_call>`). */
export interface LlmToolCall {
  name: string
  arguments?: Record<string, unknown>
}

export interface LlmChunk {
  channel: 'response' | 'thought'
  text: string
}

export interface LlmDoneResult {
  promptTokens: number
  generationTokens: number
  generationTps: number
  finishReason: string
  toolCalls: LlmToolCall[]
}

export interface LlmGenerateRequest {
  /** Chat messages passed verbatim to the tokenizer's chat template (may carry
   *  richer keys than role/content, e.g. tool messages). */
  messages: Array<Record<string, unknown>>
  tools?: unknown[]
  maxTokens?: number
  temperature?: number
  topP?: number
  repetitionPenalty?: number
  enableThinking?: boolean
}

interface BridgeMessage {
  type: 'ready' | 'chunk' | 'done' | 'token_count' | 'error' | 'fatal'
  id?: string
  load_ms?: number
  channel?: 'response' | 'thought'
  text?: string
  prompt_tokens?: number
  generation_tokens?: number
  generation_tps?: number
  finish_reason?: string
  tool_calls?: LlmToolCall[]
  count?: number
  message?: string
}

interface StreamController {
  queue: LlmChunk[]
  resolveNext: (() => void) | null
  done: boolean
  error: Error | null
  result: LlmDoneResult | null
}

interface PendingRequest {
  resolve: (value: number) => void
  reject: (err: Error) => void
}

/** Cold model load + Metal warmup on a busy machine — generous by design */
const INIT_TIMEOUT_MS = 120_000
/** Grace period between the shutdown request and SIGKILL */
const SHUTDOWN_GRACE_MS = 3_000

export class LlmSidecarManager {
  private child: ChildProcessWithoutNullStreams | null = null
  private ready = false
  private disposing = false
  private nextRequestId = 0
  private streams = new Map<string, StreamController>()
  private pending = new Map<string, PendingRequest>()
  private exitCallbacks: Array<(code: number | null) => void> = []

  /**
   * Spawn the bridge and wait for the model to load (ready message).
   */
  async initialize(options: LlmSidecarInitOptions): Promise<void> {
    if (this.child) return

    console.log(`[LlmSidecarManager] Spawning sidecar: ${options.pythonPath} ${options.bridgePath}`)

    const child = spawn(options.pythonPath, ['-u', options.bridgePath], {
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.child = child
    this.disposing = false

    createInterface({ input: child.stderr }).on('line', (line) => {
      console.log(`[LlmSidecarManager] ${line}`)
    })

    const readyPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`LLM sidecar did not become ready within ${INIT_TIMEOUT_MS / 1000}s`))
        this.killNow()
      }, INIT_TIMEOUT_MS)

      const onEarlyExit = (code: number | null): void => {
        clearTimeout(timeout)
        reject(new Error(`LLM sidecar exited during initialization (code ${code})`))
      }
      child.once('exit', onEarlyExit)

      createInterface({ input: child.stdout }).on('line', (line) => {
        let message: BridgeMessage
        try {
          message = JSON.parse(line)
        } catch {
          console.warn(`[LlmSidecarManager] Discarding malformed bridge line: ${line}`)
          return
        }

        switch (message.type) {
          case 'ready':
            clearTimeout(timeout)
            child.off('exit', onEarlyExit)
            this.ready = true
            console.log(`[LlmSidecarManager] Sidecar ready (model load ${message.load_ms}ms)`)
            resolve()
            break
          case 'chunk':
            this.handleChunk(message)
            break
          case 'done':
            this.handleDone(message)
            break
          case 'token_count': {
            const p = this.pending.get(message.id ?? '')
            if (p) {
              this.pending.delete(message.id ?? '')
              p.resolve(message.count ?? 0)
            }
            break
          }
          case 'error':
            this.handleError(message)
            break
          case 'fatal':
            console.error(`[LlmSidecarManager] Fatal sidecar error: ${message.message}`)
            clearTimeout(timeout)
            child.off('exit', onEarlyExit)
            reject(new Error(message.message ?? 'Fatal sidecar error'))
            break
        }
      })

      child.on('exit', (code) => {
        const wasDisposing = this.disposing
        this.ready = false
        this.child = null

        const err = new Error(`LLM sidecar exited (code ${code})`)
        for (const [, controller] of this.streams) {
          controller.error = err
          controller.done = true
          controller.resolveNext?.()
        }
        this.streams.clear()
        for (const [, p] of this.pending) p.reject(err)
        this.pending.clear()

        if (!wasDisposing) {
          console.error(`[LlmSidecarManager] Sidecar exited unexpectedly with code ${code}`)
          for (const callback of this.exitCallbacks) callback(code)
        }
      })

      this.send({ type: 'init', id: 'init', model_path: options.modelPath, warmup: true })
    })

    return readyPromise
  }

  isReady(): boolean {
    return this.ready && this.child !== null
  }

  /** Register a callback for unexpected sidecar exits (not fired on dispose()). */
  onExit(callback: (code: number | null) => void): void {
    this.exitCallbacks.push(callback)
  }

  /**
   * Stream a chat completion. Yields response/thought chunks as they arrive and
   * returns the final token stats + any parsed tool calls. Aborting `signal`
   * interrupts the in-flight generation in the bridge.
   */
  async *generate(
    request: LlmGenerateRequest,
    signal?: AbortSignal
  ): AsyncGenerator<LlmChunk, LlmDoneResult> {
    if (!this.child || this.disposing || !this.ready) {
      throw new Error('LLM sidecar not running')
    }

    const requestId = `g${this.nextRequestId++}`
    const controller: StreamController = {
      queue: [],
      resolveNext: null,
      done: false,
      error: null,
      result: null
    }
    this.streams.set(requestId, controller)

    const onAbort = (): void => this.send({ type: 'abort', id: requestId })
    if (signal) {
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }

    this.send({
      type: 'generate',
      id: requestId,
      messages: request.messages,
      tools: request.tools ?? null,
      max_tokens: request.maxTokens ?? 2048,
      temperature: request.temperature ?? 0.7,
      top_p: request.topP ?? 1.0,
      repetition_penalty: request.repetitionPenalty ?? null,
      enable_thinking: request.enableThinking ?? true
    })

    try {
      while (true) {
        if (controller.queue.length > 0) {
          yield controller.queue.shift()!
          continue
        }
        if (controller.error) throw controller.error
        if (controller.done) {
          return (
            controller.result ?? {
              promptTokens: 0,
              generationTokens: 0,
              generationTps: 0,
              finishReason: 'stop',
              toolCalls: []
            }
          )
        }
        await new Promise<void>((resolve) => {
          controller.resolveNext = resolve
        })
      }
    } finally {
      // If the consumer abandoned the generator early, stop the bridge too.
      if (!controller.done) this.send({ type: 'abort', id: requestId })
      if (signal) signal.removeEventListener('abort', onAbort)
      this.streams.delete(requestId)
    }
  }

  /** Count tokens for `text` using the model's tokenizer (for summary budgeting). */
  countTokens(text: string): Promise<number> {
    if (!this.child || this.disposing || !this.ready) {
      return Promise.reject(new Error('LLM sidecar not running'))
    }
    const requestId = `c${this.nextRequestId++}`
    return new Promise<number>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject })
      this.send({ type: 'count_tokens', id: requestId, text })
    })
  }

  /** Gracefully shut down the sidecar; SIGKILL after a short grace period. */
  async dispose(): Promise<void> {
    const child = this.child
    if (!child) return

    console.log('[LlmSidecarManager] Disposing...')
    this.disposing = true
    this.ready = false

    await new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        console.warn('[LlmSidecarManager] Sidecar did not exit in time — killing')
        child.kill('SIGKILL')
      }, SHUTDOWN_GRACE_MS)

      child.once('exit', () => {
        clearTimeout(killTimer)
        resolve()
      })

      this.send({ type: 'shutdown' })
    })

    this.child = null
    console.log('[LlmSidecarManager] Disposed')
  }

  private handleChunk(message: BridgeMessage): void {
    const controller = this.streams.get(message.id ?? '')
    if (!controller || !message.text) return
    controller.queue.push({ channel: message.channel ?? 'response', text: message.text })
    controller.resolveNext?.()
    controller.resolveNext = null
  }

  private handleDone(message: BridgeMessage): void {
    const controller = this.streams.get(message.id ?? '')
    if (!controller) return
    controller.result = {
      promptTokens: message.prompt_tokens ?? 0,
      generationTokens: message.generation_tokens ?? 0,
      generationTps: message.generation_tps ?? 0,
      finishReason: message.finish_reason ?? 'stop',
      toolCalls: message.tool_calls ?? []
    }
    controller.done = true
    controller.resolveNext?.()
    controller.resolveNext = null
  }

  private handleError(message: BridgeMessage): void {
    const id = message.id ?? ''
    const err = new Error(message.message ?? 'Unknown sidecar error')
    const controller = this.streams.get(id)
    if (controller) {
      controller.error = err
      controller.done = true
      controller.resolveNext?.()
      controller.resolveNext = null
      return
    }
    const p = this.pending.get(id)
    if (p) {
      this.pending.delete(id)
      p.reject(err)
    }
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
