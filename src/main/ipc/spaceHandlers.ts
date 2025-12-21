import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { SpaceManager, Space } from '../utils/spaceManager'

export function registerSpaceHandlers(spaceManager: SpaceManager): void {
  // List all spaces
  ipcMain.handle('space:list', async (_event: IpcMainInvokeEvent) => {
    try {
      return await spaceManager.listSpaces()
    } catch (error) {
      throw new Error(`Failed to list spaces: ${(error as Error).message}`)
    }
  })

  // Get a single space by ID
  ipcMain.handle('space:get', async (_event: IpcMainInvokeEvent, spaceId: string) => {
    try {
      return await spaceManager.getSpace(spaceId)
    } catch (error) {
      throw new Error(`Failed to get space: ${(error as Error).message}`)
    }
  })

  // Create a new space
  ipcMain.handle('space:create', async (_event: IpcMainInvokeEvent, name: string, icon: string) => {
    try {
      return await spaceManager.createSpace(name, icon)
    } catch (error) {
      throw new Error(`Failed to create space: ${(error as Error).message}`)
    }
  })

  // Update space metadata
  ipcMain.handle(
    'space:update',
    async (_event: IpcMainInvokeEvent, spaceId: string, updates: Partial<Space>) => {
      try {
        return await spaceManager.updateSpace(spaceId, updates)
      } catch (error) {
        throw new Error(`Failed to update space: ${(error as Error).message}`)
      }
    }
  )

  // Delete a space
  ipcMain.handle('space:delete', async (_event: IpcMainInvokeEvent, spaceId: string) => {
    try {
      await spaceManager.deleteSpace(spaceId)
    } catch (error) {
      throw new Error(`Failed to delete space: ${(error as Error).message}`)
    }
  })
}
