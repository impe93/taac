import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  protocol,
  net,
  session,
  desktopCapturer
} from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { FileSystemManager } from './utils/fileSystem'
import { SpaceManager } from './utils/spaceManager'
import { configStore } from './utils/configStore'
import { registerFileHandlers } from './ipc/fileHandlers'
import { registerConfigHandlers } from './ipc/configHandlers'
import { registerSpaceHandlers } from './ipc/spaceHandlers'
import {
  registerAIHandlers,
  notifyNoteSaved,
  notifyFolderMoved,
  disposeIndexingQueue,
  cancelBatchIndexing,
  initializeEmbeddingSubsystem
} from './ipc/aiHandlers'
import { registerImportHandlers } from './ipc/importHandlers'
import { registerAudioHandlers } from './ipc/audioHandlers'
import { AudioManager } from './audio/AudioManager'
import { RealtimeTranscriptionService } from './audio/realtime/RealtimeTranscriptionService'

// Register custom protocol for serving local assets
// Must be called before app is ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'taac-asset',
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      bypassCSP: true
    }
  }
])

let spaceManager: SpaceManager
const fsManagerMap = new Map<string, FileSystemManager>()

// Get or create FileSystemManager for a specific space
export function getOrCreateFsManager(spaceId: string): FileSystemManager {
  if (!fsManagerMap.has(spaceId)) {
    const manager = new FileSystemManager(spaceId)
    fsManagerMap.set(spaceId, manager)

    // Initialize the new FileSystemManager asynchronously
    // This ensures the file structure is set up when switching spaces
    manager.initialize().catch((error) => {
      console.error(`[Main] Failed to initialize FileSystemManager for space ${spaceId}:`, error)
    })
  }
  return fsManagerMap.get(spaceId)!
}

function createWindow(): void {
  const savedBounds = configStore.get('windowBounds')
  const savedIsMaximized = configStore.get('isMaximized')

  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: savedBounds.width,
    height: savedBounds.height,
    ...(savedBounds.x !== undefined && savedBounds.y !== undefined
      ? { x: savedBounds.x, y: savedBounds.y }
      : {}),
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
    if (savedIsMaximized) {
      mainWindow.maximize()
    }
    mainWindow.show()
    mainWindow.focus()
    if (is.dev) {
      mainWindow.webContents.openDevTools()
    }
  })

  // Save window state on close
  mainWindow.on('close', () => {
    const isMaximized = mainWindow.isMaximized()
    configStore.set('isMaximized', isMaximized)
    if (!isMaximized) {
      configStore.set('windowBounds', mainWindow.getBounds())
    }
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

  // Register protocol handler for local assets
  // URL format: taac-asset://spaceId/type/filename
  // Example: taac-asset://abc123/images/image.png
  protocol.handle('taac-asset', (request) => {
    const url = new URL(request.url)
    // The hostname is the spaceId, pathname is /type/filename
    const spaceId = url.hostname
    const pathParts = url.pathname.split('/').filter(Boolean)

    if (pathParts.length < 2) {
      return new Response('Invalid asset path', { status: 400 })
    }

    const assetType = pathParts[0] // 'images', 'pdfs', 'attachments'
    const filename = pathParts.slice(1).join('/')

    // Construct the file path
    const assetPath = join(
      app.getPath('userData'),
      'spaces',
      spaceId,
      'assets',
      assetType,
      filename
    )

    // Use net.fetch to load the file (converts to file:// internally but allowed in main process)
    return net.fetch(pathToFileURL(assetPath).toString())
  })

  // Initialize space manager
  spaceManager = new SpaceManager()
  await spaceManager.initialize()

  // Ensure default "Personal" space exists (only for post-onboarding users)
  const spaces = await spaceManager.listSpaces()
  const onboardingDone = configStore.get('onboardingCompleted')
  if (spaces.length === 0 && onboardingDone) {
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
  registerFileHandlers(getOrCreateFsManager, notifyNoteSaved, (spaceId, folderId) =>
    notifyFolderMoved(getOrCreateFsManager, spaceId, folderId)
  )
  registerConfigHandlers()
  registerAIHandlers(getOrCreateFsManager)
  registerImportHandlers(spaceManager, getOrCreateFsManager)
  registerAudioHandlers()

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  // Handle opening external URLs in the default browser
  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    await shell.openExternal(url)
  })

  createWindow()

  // Deferred embedding subsystem init — enables auto-indexing without requiring
  // the user to open the AI chat panel first. Runs after window is visible.
  setTimeout(() => {
    initializeEmbeddingSubsystem(getOrCreateFsManager).catch((error) => {
      console.error('[App] Deferred embedding init failed:', error)
    })
  }, 2000)

  // Register display media request handler for system audio loopback capture (§3.2)
  // Must be set up after app is ready so session is available
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    console.log('[AudioSetup] Display media requested', {
      videoRequested: request.videoRequested,
      audioRequested: request.audioRequested
    })

    const sources = await desktopCapturer.getSources({ types: ['screen'] })
    if (sources.length === 0) {
      console.error(
        '[AudioSetup] No screen sources available — Screen Recording permission may be denied'
      )
      callback({})
      return
    }

    callback({
      video: sources[0], // Screen source required by API even when only audio is needed
      audio: 'loopback' // System audio loopback
    })
  })
  console.log('[AudioSetup] setDisplayMediaRequestHandler registered on default session')

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

app.on('before-quit', async () => {
  cancelBatchIndexing()
  disposeIndexingQueue()
  // Quit mid-recording must never leave an orphan Python sidecar process
  await RealtimeTranscriptionService.getInstance().abortAll()
  await AudioManager.getInstance().dispose()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
