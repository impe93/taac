/**
 * MlxLlmBackend — MLX text-generation backend (Apple Silicon)
 *
 * Wraps a single LlmSidecarManager (Python mlx-lm) and exposes the low-level
 * primitives AIManager needs to route `format: 'mlx'` chat models through the
 * sidecar instead of node-llama-cpp: load/unload, token counting, and a raw
 * streaming generator. The RAG tool-call agent loop lives in AIManager (it owns
 * the searchNotes schema + note formatting), so this backend stays a thin,
 * model-agnostic generation primitive.
 *
 * Only one MLX chat model is loaded at a time — spawning a second sidecar would
 * blow the 16GB memory budget. Loading a different model disposes the current
 * one first.
 */

import { app } from 'electron'
import { join } from 'node:path'
import { ModelRegistry } from '../ModelRegistry'
import type { LoadedModel } from '../types'
import { resolveLlmBridgePath, resolveLlmPython } from '../../audio/realtime/pythonRuntime'
import {
  LlmSidecarManager,
  type LlmChunk,
  type LlmDoneResult,
  type LlmGenerateRequest
} from './LlmSidecarManager'

export class MlxLlmBackend {
  private sidecar: LlmSidecarManager | null = null
  private loadedModelId: string | null = null
  private lastUsed = 0
  private loadPromise: Promise<void> | null = null

  private modelDir(modelId: string): string {
    // MLX checkpoints are multi-file, downloaded into {userData}/models/{id}/
    return join(app.getPath('userData'), 'models', modelId)
  }

  /**
   * Ensure the sidecar is running with `modelId` loaded. Serialized so that
   * concurrent callers (chat + summary racing) don't spawn two sidecars.
   */
  private async ensureLoaded(modelId: string): Promise<void> {
    if (this.sidecar?.isReady() && this.loadedModelId === modelId) return
    if (this.loadPromise) {
      await this.loadPromise
      if (this.sidecar?.isReady() && this.loadedModelId === modelId) return
    }
    this.loadPromise = this.doLoad(modelId)
    try {
      await this.loadPromise
    } finally {
      this.loadPromise = null
    }
  }

  private async doLoad(modelId: string): Promise<void> {
    // A different model is loaded — free it first (one MLX model at a time).
    if (this.sidecar && this.loadedModelId !== modelId) {
      await this.unload()
    }
    if (this.sidecar?.isReady()) return

    const pythonPath = await resolveLlmPython()
    if (!pythonPath) {
      throw new Error('MLX LLM sidecar unavailable: no Python runtime found')
    }
    const bridgePath = resolveLlmBridgePath()
    const modelPath = this.modelDir(modelId)

    const sidecar = new LlmSidecarManager()
    sidecar.onExit((code) => {
      console.error(`[MlxLlmBackend] Sidecar exited unexpectedly (code ${code})`)
      if (this.sidecar === sidecar) {
        this.sidecar = null
        this.loadedModelId = null
      }
    })
    await sidecar.initialize({ pythonPath, bridgePath, modelPath })
    this.sidecar = sidecar
    this.loadedModelId = modelId
    this.lastUsed = Date.now()
  }

  /** Ensure `modelId` is loaded and return its metadata (mirrors AIManager.loadModel). */
  async load(modelId: string): Promise<LoadedModel> {
    await this.ensureLoaded(modelId)
    this.lastUsed = Date.now()
    return {
      id: modelId,
      lastUsed: this.lastUsed,
      memoryUsage: ModelRegistry.getModel(modelId)?.sizeBytes ?? 0
    }
  }

  /** Dispose the sidecar and free the loaded model. */
  async unload(): Promise<void> {
    const sidecar = this.sidecar
    this.sidecar = null
    this.loadedModelId = null
    if (sidecar) await sidecar.dispose()
  }

  isLoaded(modelId: string): boolean {
    return this.sidecar?.isReady() === true && this.loadedModelId === modelId
  }

  getLoadedModels(): LoadedModel[] {
    if (!this.sidecar?.isReady() || !this.loadedModelId) return []
    return [
      {
        id: this.loadedModelId,
        lastUsed: this.lastUsed,
        memoryUsage: ModelRegistry.getModel(this.loadedModelId)?.sizeBytes ?? 0
      }
    ]
  }

  /** Count tokens with the model's tokenizer (summary map-reduce budgeting). */
  async countTokens(modelId: string, text: string): Promise<number> {
    await this.ensureLoaded(modelId)
    this.lastUsed = Date.now()
    return this.sidecar!.countTokens(text)
  }

  /**
   * Raw streaming generation. Yields response/thought chunks and returns the
   * final token stats + parsed tool calls. AIManager wraps this with the RAG
   * agent loop and the ChatCompletionResult contract.
   */
  async *generateStream(
    modelId: string,
    request: LlmGenerateRequest,
    signal?: AbortSignal
  ): AsyncGenerator<LlmChunk, LlmDoneResult> {
    await this.ensureLoaded(modelId)
    this.lastUsed = Date.now()
    const result = yield* this.sidecar!.generate(request, signal)
    this.lastUsed = Date.now()
    return result
  }

  /** Dispose the sidecar if it has been idle longer than `timeoutMs`. */
  async cleanupIdle(timeoutMs: number): Promise<void> {
    if (!this.sidecar || !this.loadedModelId) return
    if (Date.now() - this.lastUsed > timeoutMs) {
      console.log(`[MlxLlmBackend] Unloading idle MLX model ${this.loadedModelId}`)
      await this.unload()
    }
  }

  async dispose(): Promise<void> {
    await this.unload()
  }
}
