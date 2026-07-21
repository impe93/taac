import { app, ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  checkForUpdates,
  downloadUpdate,
  getUpdaterState,
  requestInstall,
  type UpdaterState
} from '../utils/updater'

export function registerUpdaterHandlers(): void {
  // Manual check triggered from Settings.
  ipcMain.handle('updater:check', async (_event: IpcMainInvokeEvent): Promise<UpdaterState> => {
    return checkForUpdates()
  })

  // Only needed when automatic downloads are disabled.
  ipcMain.handle('updater:download', async (_event: IpcMainInvokeEvent): Promise<void> => {
    await downloadUpdate()
  })

  // Quits (disposing sidecars first) and installs the downloaded update.
  ipcMain.handle('updater:install', (_event: IpcMainInvokeEvent): void => {
    requestInstall()
  })

  ipcMain.handle('updater:getState', (_event: IpcMainInvokeEvent): UpdaterState => {
    return getUpdaterState()
  })

  ipcMain.handle('updater:getAppVersion', (_event: IpcMainInvokeEvent): string => {
    return app.getVersion()
  })
}
