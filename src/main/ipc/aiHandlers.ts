/**
 * AI IPC Handlers
 *
 * Handles IPC communication for AI-related operations including:
 * - Hardware detection
 * - Model recommendations
 * - Model management
 *
 * Reference: docs/AI_ARCHITECTURE.md section 7
 */

import { ipcMain, BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { HardwareDetector, ModelRegistry, ModelDownloader } from '../ai'
import type { FileSystemManager } from '../utils/fileSystem'

type GetFsManager = (spaceId: string) => FileSystemManager

// Singleton instance of the model downloader
let downloader: ModelDownloader | null = null

/**
 * Get or create the ModelDownloader singleton
 */
async function getDownloader(): Promise<ModelDownloader> {
  if (!downloader) {
    downloader = new ModelDownloader()
    await downloader.initialize()
  }
  return downloader
}

/**
 * Forward progress events to all BrowserWindows
 */
function setupProgressForwarding(dl: ModelDownloader): void {
  dl.on('progress', (progress) => {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('ai:download-progress', progress)
    }
  })
}

/**
 * Register AI-related IPC handlers
 */
export function registerAIHandlers(_getOrCreateFsManager: GetFsManager): void {
  // Initialize downloader and setup progress forwarding
  getDownloader().then(setupProgressForwarding).catch(console.error)

  // ============================================================================
  // HARDWARE DETECTION
  // ============================================================================

  /**
   * Get system hardware information including CPU, RAM, GPU specs
   */
  ipcMain.handle('ai:getHardwareInfo', async (_event: IpcMainInvokeEvent) => {
    try {
      return await HardwareDetector.detect()
    } catch (error) {
      throw new Error(`Failed to detect hardware: ${(error as Error).message}`)
    }
  })

  /**
   * Get model recommendations based on detected hardware tier
   */
  ipcMain.handle('ai:getModelRecommendations', async (_event: IpcMainInvokeEvent) => {
    try {
      return await HardwareDetector.getModelRecommendations()
    } catch (error) {
      throw new Error(`Failed to get model recommendations: ${(error as Error).message}`)
    }
  })

  // ============================================================================
  // MODEL MANAGEMENT
  // ============================================================================

  /**
   * List all available models from the curated registry
   */
  ipcMain.handle('ai:listAvailableModels', (_event: IpcMainInvokeEvent) => {
    try {
      return ModelRegistry.getAllModels()
    } catch (error) {
      throw new Error(`Failed to list available models: ${(error as Error).message}`)
    }
  })

  /**
   * List all downloaded models
   */
  ipcMain.handle('ai:listDownloadedModels', async (_event: IpcMainInvokeEvent) => {
    try {
      const dl = await getDownloader()
      return await dl.getDownloadedModels()
    } catch (error) {
      throw new Error(`Failed to list downloaded models: ${(error as Error).message}`)
    }
  })

  /**
   * Check if a specific model is downloaded
   */
  ipcMain.handle('ai:isModelDownloaded', async (_event: IpcMainInvokeEvent, modelId: string) => {
    try {
      const dl = await getDownloader()
      return await dl.isModelDownloaded(modelId)
    } catch (error) {
      throw new Error(`Failed to check model status: ${(error as Error).message}`)
    }
  })

  /**
   * Start downloading a model
   */
  ipcMain.handle('ai:downloadModel', async (_event: IpcMainInvokeEvent, modelId: string) => {
    try {
      const model = ModelRegistry.getModel(modelId)
      if (!model) {
        throw new Error(`Unknown model: ${modelId}`)
      }

      const dl = await getDownloader()
      await dl.downloadModel(modelId, model.downloadUrl, model.filename)
      return { success: true }
    } catch (error) {
      throw new Error(`Failed to download model: ${(error as Error).message}`)
    }
  })

  /**
   * Pause an active download
   */
  ipcMain.handle('ai:pauseDownload', async (_event: IpcMainInvokeEvent, modelId: string) => {
    try {
      const dl = await getDownloader()
      dl.pauseDownload(modelId)
      return { success: true }
    } catch (error) {
      throw new Error(`Failed to pause download: ${(error as Error).message}`)
    }
  })

  /**
   * Resume a paused download
   */
  ipcMain.handle('ai:resumeDownload', async (_event: IpcMainInvokeEvent, modelId: string) => {
    try {
      const dl = await getDownloader()
      await dl.resumeDownload(modelId)
      return { success: true }
    } catch (error) {
      throw new Error(`Failed to resume download: ${(error as Error).message}`)
    }
  })

  /**
   * Cancel and cleanup a download
   */
  ipcMain.handle('ai:cancelDownload', async (_event: IpcMainInvokeEvent, modelId: string) => {
    try {
      const dl = await getDownloader()
      await dl.cancelDownload(modelId)
      return { success: true }
    } catch (error) {
      throw new Error(`Failed to cancel download: ${(error as Error).message}`)
    }
  })

  /**
   * Delete a downloaded model
   */
  ipcMain.handle('ai:deleteModel', async (_event: IpcMainInvokeEvent, modelId: string) => {
    try {
      const dl = await getDownloader()
      await dl.deleteModel(modelId)
      return { success: true }
    } catch (error) {
      throw new Error(`Failed to delete model: ${(error as Error).message}`)
    }
  })
}
