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

import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { HardwareDetector, ModelRegistry } from '../ai'
import type { FileSystemManager } from '../utils/fileSystem'

type GetFsManager = (spaceId: string) => FileSystemManager

/**
 * Register AI-related IPC handlers
 */
export function registerAIHandlers(_getOrCreateFsManager: GetFsManager): void {
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
}
