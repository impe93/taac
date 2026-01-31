/**
 * Model Downloader
 *
 * Handles model downloads with:
 * - Progress tracking
 * - Pause/resume support
 * - Temp file management for interrupted downloads
 *
 * Reference: docs/AI_ARCHITECTURE.md section 6.3
 */

import { app } from 'electron'
import { createWriteStream, promises as fs } from 'fs'
import { join } from 'path'
import { EventEmitter } from 'events'
import type { DownloadProgress } from './types'
import { DownloadFailedError } from './errors'
import { ModelRegistry } from './ModelRegistry'

/**
 * Internal download task tracking
 */
interface DownloadTask {
  modelId: string
  url: string
  filename: string
  abortController: AbortController
  resumePosition: number
}

/**
 * Progress event listener type
 */
export type ProgressListener = (progress: DownloadProgress) => void

export class ModelDownloader extends EventEmitter {
  private downloads: Map<string, DownloadTask> = new Map()
  private progressCache: Map<string, DownloadProgress> = new Map()
  private modelsDir: string
  private tempDir: string

  constructor() {
    super()
    this.modelsDir = join(app.getPath('userData'), 'models')
    this.tempDir = join(this.modelsDir, '.temp')
  }

  /**
   * Initialize directories and cleanup old temp files
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.modelsDir, { recursive: true })
    await fs.mkdir(this.tempDir, { recursive: true })
    await this.cleanupOldTempFiles()
  }

  /**
   * Start downloading a model
   */
  async downloadModel(modelId: string, url: string, filename: string): Promise<void> {
    if (this.downloads.has(modelId)) {
      throw new DownloadFailedError(modelId, 'Download already in progress')
    }

    const task: DownloadTask = {
      modelId,
      url,
      filename,
      abortController: new AbortController(),
      resumePosition: 0
    }

    this.downloads.set(modelId, task)

    try {
      await this.executeDownload(task)
    } finally {
      this.downloads.delete(modelId)
    }
  }

  /**
   * Execute the actual download with resume support
   */
  private async executeDownload(task: DownloadTask): Promise<void> {
    const tempPath = join(this.tempDir, `${task.modelId}.part`)
    const finalPath = join(this.modelsDir, task.filename)

    // Check for partial download to resume
    try {
      const stats = await fs.stat(tempPath)
      task.resumePosition = stats.size
    } catch {
      task.resumePosition = 0
    }

    // Setup request headers for resume
    const headers: Record<string, string> = {}
    if (task.resumePosition > 0) {
      headers['Range'] = `bytes=${task.resumePosition}-`
    }

    // Emit pending status
    this.emitProgress({
      modelId: task.modelId,
      filename: task.filename,
      bytesDownloaded: task.resumePosition,
      totalBytes: 0,
      percentage: 0,
      speed: 0,
      eta: 0,
      status: 'pending'
    })

    const response = await fetch(task.url, {
      headers,
      signal: task.abortController.signal
    })

    if (!response.ok && response.status !== 206) {
      throw new DownloadFailedError(task.modelId, `HTTP ${response.status} ${response.statusText}`)
    }

    const contentLength = parseInt(response.headers.get('content-length') || '0')
    const totalBytes = task.resumePosition + contentLength

    // Create write stream (append mode if resuming)
    const writer = createWriteStream(tempPath, {
      flags: task.resumePosition > 0 ? 'a' : 'w'
    })

    let bytesDownloaded = task.resumePosition
    let lastTime = Date.now()
    let lastBytes = bytesDownloaded

    const reader = response.body?.getReader()
    if (!reader) {
      throw new DownloadFailedError(task.modelId, 'No response body')
    }

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        writer.write(value)
        bytesDownloaded += value.length

        // Calculate and emit progress every 500ms
        const now = Date.now()
        if (now - lastTime >= 500) {
          const speed = ((bytesDownloaded - lastBytes) / (now - lastTime)) * 1000
          const remaining = totalBytes - bytesDownloaded
          const eta = speed > 0 ? remaining / speed : 0

          this.emitProgress({
            modelId: task.modelId,
            filename: task.filename,
            bytesDownloaded,
            totalBytes,
            percentage: totalBytes > 0 ? (bytesDownloaded / totalBytes) * 100 : 0,
            speed,
            eta,
            status: 'downloading'
          })

          lastTime = now
          lastBytes = bytesDownloaded
        }
      }

      // Wait for write stream to finish
      await new Promise<void>((resolve, reject) => {
        writer.end()
        writer.on('finish', resolve)
        writer.on('error', reject)
      })

      // Move from temp to final location
      await fs.rename(tempPath, finalPath)

      // Emit completion
      this.emitProgress({
        modelId: task.modelId,
        filename: task.filename,
        bytesDownloaded: totalBytes,
        totalBytes,
        percentage: 100,
        speed: 0,
        eta: 0,
        status: 'completed'
      })
    } catch (error) {
      // Close writer on error
      writer.end()

      if ((error as Error).name === 'AbortError') {
        // Download was paused
        this.emitProgress({
          modelId: task.modelId,
          filename: task.filename,
          bytesDownloaded,
          totalBytes,
          percentage: totalBytes > 0 ? (bytesDownloaded / totalBytes) * 100 : 0,
          speed: 0,
          eta: 0,
          status: 'paused'
        })
      } else {
        // Real error
        this.emitProgress({
          modelId: task.modelId,
          filename: task.filename,
          bytesDownloaded,
          totalBytes,
          percentage: totalBytes > 0 ? (bytesDownloaded / totalBytes) * 100 : 0,
          speed: 0,
          eta: 0,
          status: 'error',
          error: (error as Error).message
        })
        throw error
      }
    }
  }

  /**
   * Pause an active download
   */
  pauseDownload(modelId: string): void {
    const task = this.downloads.get(modelId)
    if (task) {
      task.abortController.abort()
    }
  }

  /**
   * Resume a paused download
   */
  async resumeDownload(modelId: string): Promise<void> {
    const model = ModelRegistry.getModel(modelId)
    if (!model) {
      throw new DownloadFailedError(modelId, 'Unknown model')
    }

    await this.downloadModel(modelId, model.downloadUrl, model.filename)
  }

  /**
   * Cancel a download and remove temp file
   */
  async cancelDownload(modelId: string): Promise<void> {
    const task = this.downloads.get(modelId)
    if (task) {
      task.abortController.abort()
      this.downloads.delete(modelId)
    }

    // Remove temp file
    const tempPath = join(this.tempDir, `${modelId}.part`)
    try {
      await fs.unlink(tempPath)
    } catch {
      // Ignore if file doesn't exist
    }

    // Clear cached progress
    this.progressCache.delete(modelId)
  }

  /**
   * Check if a model is downloaded
   */
  async isModelDownloaded(modelId: string): Promise<boolean> {
    const model = ModelRegistry.getModel(modelId)
    if (!model) return false

    const modelPath = join(this.modelsDir, model.filename)
    try {
      const stats = await fs.stat(modelPath)
      // Check if file exists and has reasonable size
      return stats.size > 0
    } catch {
      return false
    }
  }

  /**
   * Get list of downloaded models with full definitions
   */
  async getDownloadedModels(): Promise<import('./types').ModelDefinition[]> {
    try {
      const files = await fs.readdir(this.modelsDir)
      return files
        .filter((f) => f.endsWith('.gguf'))
        .map((f) => ModelRegistry.getModelByFilename(f))
        .filter((model): model is import('./types').ModelDefinition => model !== undefined)
    } catch {
      return []
    }
  }

  /**
   * Delete a downloaded model
   */
  async deleteModel(modelId: string): Promise<void> {
    const model = ModelRegistry.getModel(modelId)
    if (!model) return

    const modelPath = join(this.modelsDir, model.filename)
    try {
      await fs.unlink(modelPath)
    } catch {
      // Ignore if file doesn't exist
    }
  }

  /**
   * Get download progress for a model
   */
  getProgress(modelId: string): DownloadProgress | null {
    return this.progressCache.get(modelId) || null
  }

  /**
   * Check if a download is in progress
   */
  isDownloading(modelId: string): boolean {
    return this.downloads.has(modelId)
  }

  /**
   * Get the models directory path
   */
  getModelsDir(): string {
    return this.modelsDir
  }

  /**
   * Get model file path
   */
  getModelPath(modelId: string): string | null {
    const model = ModelRegistry.getModel(modelId)
    if (!model) return null
    return join(this.modelsDir, model.filename)
  }

  /**
   * Cleanup old temp files (older than 7 days)
   */
  async cleanupOldTempFiles(): Promise<void> {
    try {
      const files = await fs.readdir(this.tempDir)
      const maxAge = 7 * 24 * 60 * 60 * 1000 // 7 days

      for (const file of files) {
        if (file.endsWith('.part')) {
          const filePath = join(this.tempDir, file)
          const stats = await fs.stat(filePath)
          const age = Date.now() - stats.mtimeMs

          if (age > maxAge) {
            await fs.unlink(filePath)
          }
        }
      }
    } catch {
      // Ignore errors during cleanup
    }
  }

  /**
   * Helper to emit progress and cache it
   */
  private emitProgress(progress: DownloadProgress): void {
    this.progressCache.set(progress.modelId, progress)
    this.emit('progress', progress)

    // Clear cache on terminal states
    if (progress.status === 'completed' || progress.status === 'error') {
      // Keep in cache briefly for status queries
      setTimeout(() => {
        const cached = this.progressCache.get(progress.modelId)
        if (cached?.status === progress.status) {
          this.progressCache.delete(progress.modelId)
        }
      }, 5000)
    }
  }
}
