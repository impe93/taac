import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { configStore } from './configStore'
import type { UpdaterState } from '../../preload/types'

/**
 * Auto-update subsystem (electron-updater over GitHub Releases).
 *
 * The published macOS artifacts are a `.dmg` (first install) and a `.zip`
 * (Squirrel.Mac requires the zip; `latest-mac.yml` points at it). Both are
 * signed + notarized — Squirrel refuses to install an update whose signature
 * does not match the running app.
 *
 * Shutdown ordering: the app disposes native/Python sidecars in `before-quit`
 * (see src/main/index.ts). `quitAndInstall()` must therefore NOT be called
 * directly from an IPC handler — it would race the dispose. Instead
 * `requestInstall()` arms a flag and quits normally; `finalizeQuit()` (called
 * at the end of the existing shutdown sequence) performs the install.
 */

export type { UpdaterState }

/** Delay before the first check: lets the window paint and the AI subsystem boot first. */
const FIRST_CHECK_DELAY_MS = 15_000
/** Periodic re-check while the app stays open. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

let state: UpdaterState = { status: 'idle', currentVersion: app.getVersion() }
let pendingInstall = false
let checkTimer: NodeJS.Timeout | null = null
let initialized = false

function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('updater:status', state)
    }
  }
}

function setState(next: Omit<UpdaterState, 'currentVersion'>): void {
  state = { ...next, currentVersion: app.getVersion() }
  broadcast()
}

export function getUpdaterState(): UpdaterState {
  return state
}

/**
 * In development electron-updater reads `dev-app-update.yml`. Checks are off by
 * default there (the running app is unsigned and cannot install anything);
 * set `TAAC_FORCE_UPDATE_CHECK=1` to exercise the check/publish plumbing.
 */
function isUpdaterEnabled(): boolean {
  if (!app.isPackaged && process.env.TAAC_FORCE_UPDATE_CHECK !== '1') return false
  // macOS auto-update requires a signed app; unsigned local builds would fail
  // with an opaque Squirrel error, so bail out early.
  return true
}

/** Runs a check, honouring the user's `autoUpdateEnabled` preference. */
async function runScheduledCheck(): Promise<void> {
  if (!configStore.get('autoUpdateEnabled')) {
    console.log('[Updater] Automatic checks disabled by user — skipping')
    return
  }
  await checkForUpdates()
}

/**
 * Check GitHub Releases for a newer version. Safe to call at any time; errors
 * are surfaced through the state instead of throwing.
 */
export async function checkForUpdates(): Promise<UpdaterState> {
  if (!isUpdaterEnabled()) {
    console.log('[Updater] Skipping check — app is not packaged')
    return state
  }
  if (state.status === 'checking' || state.status === 'downloading') return state

  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    console.error('[Updater] Check failed:', error)
    setState({ status: 'error', message: (error as Error).message })
  }
  return state
}

/** Explicit download, used when `autoDownload` is off (user opted out of automatic updates). */
export async function downloadUpdate(): Promise<void> {
  if (!isUpdaterEnabled()) return
  try {
    await autoUpdater.downloadUpdate()
  } catch (error) {
    console.error('[Updater] Download failed:', error)
    setState({ status: 'error', message: (error as Error).message })
  }
}

/**
 * Arm the install and quit. The actual `quitAndInstall()` happens in
 * `finalizeQuit()`, after the app has disposed its sidecars.
 */
export function requestInstall(): void {
  if (state.status !== 'downloaded') {
    console.warn('[Updater] Install requested but no update is downloaded')
    return
  }
  pendingInstall = true
  app.quit()
}

/**
 * Terminal step of the shutdown sequence: installs the pending update if one is
 * armed, otherwise quits normally. Called from the `before-quit` cleanup chain.
 */
export function finalizeQuit(): void {
  if (pendingInstall) {
    console.log('[Updater] Installing update and restarting')
    // isSilent = true, isForceRunAfter = true → relaunch into the new version.
    autoUpdater.quitAndInstall(true, true)
    return
  }
  app.quit()
}

/** Wires the electron-updater events and schedules the periodic check. Idempotent. */
export function initAutoUpdater(): void {
  if (initialized) return
  initialized = true

  autoUpdater.autoDownload = configStore.get('autoUpdateEnabled')
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false
  autoUpdater.logger = {
    info: (msg: unknown) => console.log('[Updater]', msg),
    warn: (msg: unknown) => console.warn('[Updater]', msg),
    error: (msg: unknown) => console.error('[Updater]', msg),
    debug: () => {}
  }

  // Keep autoDownload in sync when the user flips the preference at runtime.
  configStore.onDidChange('autoUpdateEnabled', (newValue) => {
    autoUpdater.autoDownload = newValue !== false
  })

  autoUpdater.on('checking-for-update', () => setState({ status: 'checking' }))

  autoUpdater.on('update-available', (info) => {
    console.log(`[Updater] Update available: ${info.version}`)
    setState({
      status: autoUpdater.autoDownload ? 'downloading' : 'available',
      version: info.version,
      percent: 0
    })
  })

  autoUpdater.on('update-not-available', () => setState({ status: 'not-available' }))

  autoUpdater.on('download-progress', (progress) => {
    setState({
      status: 'downloading',
      version: state.version,
      percent: Math.round(progress.percent),
      bytesPerSecond: Math.round(progress.bytesPerSecond)
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[Updater] Update downloaded: ${info.version}`)
    setState({ status: 'downloaded', version: info.version, percent: 100 })
  })

  autoUpdater.on('error', (error) => {
    console.error('[Updater] Error:', error)
    setState({ status: 'error', message: error.message })
  })

  if (!isUpdaterEnabled()) {
    console.log('[Updater] Disabled (development build without TAAC_FORCE_UPDATE_CHECK)')
    return
  }

  const firstCheck = setTimeout(() => {
    void runScheduledCheck()
  }, FIRST_CHECK_DELAY_MS)
  firstCheck.unref?.()

  checkTimer = setInterval(() => {
    void runScheduledCheck()
  }, CHECK_INTERVAL_MS)
  checkTimer.unref?.()
}

/** Stops the periodic check (used on shutdown). */
export function disposeAutoUpdater(): void {
  if (checkTimer) {
    clearInterval(checkTimer)
    checkTimer = null
  }
}
