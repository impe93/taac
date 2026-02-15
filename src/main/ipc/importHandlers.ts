import { ipcMain, dialog, BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type { SpaceManager } from '../utils/spaceManager'
import type { FileSystemManager } from '../utils/fileSystem'
import { ImportManager } from '../import/ImportManager'
import type { ImportSource, ImportOptions, ImportProgressEvent } from '../import/types'

export function registerImportHandlers(
  spaceManager: SpaceManager,
  getOrCreateFsManager: (spaceId: string) => FileSystemManager
): void {
  const importManager = ImportManager.getInstance()

  // Open native directory picker
  ipcMain.handle('import:selectFolder', async (_event: IpcMainInvokeEvent) => {
    try {
      const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
      if (result.canceled || result.filePaths.length === 0) {
        return null
      }
      return result.filePaths[0]
    } catch (error) {
      throw new Error(`Failed to open folder picker: ${(error as Error).message}`)
    }
  })

  // Pre-import scan
  ipcMain.handle(
    'import:scan',
    async (_event: IpcMainInvokeEvent, sourcePath: string, source: ImportSource) => {
      try {
        return await importManager.scan(sourcePath, source)
      } catch (error) {
        throw new Error(`Failed to scan source: ${(error as Error).message}`)
      }
    }
  )

  // Check Apple Notes database accessibility
  ipcMain.handle('import:checkAppleNotesAccess', async (_event: IpcMainInvokeEvent) => {
    try {
      return await importManager.checkAppleNotesAccess()
    } catch (error) {
      throw new Error(`Failed to check Apple Notes access: ${(error as Error).message}`)
    }
  })

  // Execute full import
  ipcMain.handle('import:start', async (_event: IpcMainInvokeEvent, options: ImportOptions) => {
    try {
      return await importManager.runImport(
        options,
        spaceManager,
        getOrCreateFsManager,
        (event: ImportProgressEvent) => {
          BrowserWindow.getAllWindows().forEach((win) => {
            win.webContents.send('import:progress', event)
          })
        }
      )
    } catch (error) {
      throw new Error(`Failed to run import: ${(error as Error).message}`)
    }
  })
}
