import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { FileSystemManager } from './utils/fileSystem'
import { SpaceManager } from './utils/spaceManager'
import { configStore } from './utils/configStore'
import { registerFileHandlers } from './ipc/fileHandlers'
import { registerConfigHandlers } from './ipc/configHandlers'
import { registerSpaceHandlers } from './ipc/spaceHandlers'

let spaceManager: SpaceManager
const fsManagerMap = new Map<string, FileSystemManager>()

// Get or create FileSystemManager for a specific space
function getOrCreateFsManager(spaceId: string): FileSystemManager {
  if (!fsManagerMap.has(spaceId)) {
    const manager = new FileSystemManager(spaceId)
    fsManagerMap.set(spaceId, manager)
  }
  return fsManagerMap.get(spaceId)!
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    mainWindow.focus()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Initialize space manager
  spaceManager = new SpaceManager()
  await spaceManager.initialize()

  // Ensure default "Personal" space exists
  const spaces = await spaceManager.listSpaces()
  if (spaces.length === 0) {
    await spaceManager.createSpace('Personal', 'Home')
    configStore.set('spacesInitialized', true)
  }

  // Set active space (from config or first available)
  let activeSpaceId = configStore.get('activeSpaceId')
  if (!activeSpaceId) {
    const currentSpaces = await spaceManager.listSpaces()
    if (currentSpaces.length > 0) {
      activeSpaceId = currentSpaces[0].id
      configStore.set('activeSpaceId', activeSpaceId)
    }
  }

  // Initialize FileSystemManager for active space
  if (activeSpaceId) {
    const fsManager = getOrCreateFsManager(activeSpaceId)
    await fsManager.initialize()
  }

  // Register IPC handlers
  registerSpaceHandlers(spaceManager)
  registerFileHandlers(getOrCreateFsManager)
  registerConfigHandlers()

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
