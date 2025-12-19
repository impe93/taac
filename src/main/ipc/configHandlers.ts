import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { configStore, type AppConfig } from '../utils/configStore'

export function registerConfigHandlers(): void {
  // Get a specific config value
  ipcMain.handle('config:get', async (_event: IpcMainInvokeEvent, key: keyof AppConfig) => {
    try {
      return configStore.get(key)
    } catch (error) {
      throw new Error(`Failed to get config: ${(error as Error).message}`)
    }
  })

  // Set a specific config value
  ipcMain.handle(
    'config:set',
    async (_event: IpcMainInvokeEvent, key: keyof AppConfig, value: unknown) => {
      try {
        configStore.set(key, value as AppConfig[keyof AppConfig])
      } catch (error) {
        throw new Error(`Failed to set config: ${(error as Error).message}`)
      }
    }
  )

  // Get all config values
  ipcMain.handle('config:getAll', async (_event: IpcMainInvokeEvent) => {
    try {
      return configStore.store
    } catch (error) {
      throw new Error(`Failed to get all config: ${(error as Error).message}`)
    }
  })

  // Reset config to defaults
  ipcMain.handle('config:reset', async (_event: IpcMainInvokeEvent) => {
    try {
      configStore.clear()
    } catch (error) {
      throw new Error(`Failed to reset config: ${(error as Error).message}`)
    }
  })

  // Watch for config changes
  ipcMain.handle('config:onChange', (_event: IpcMainInvokeEvent, key: keyof AppConfig) => {
    try {
      const unsubscribe = configStore.onDidChange(key, (newValue, oldValue) => {
        _event.sender.send('config:changed', { key, newValue, oldValue })
      })

      // Return unsubscribe function (though it won't be directly callable from renderer)
      return unsubscribe
    } catch (error) {
      throw new Error(`Failed to setup config change listener: ${(error as Error).message}`)
    }
  })
}
