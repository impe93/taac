import { useCallback, useEffect, useState } from 'react'
import type { UpdaterState } from '@preload/types'

interface UseUpdaterResult {
  state: UpdaterState
  /** Manual "Check for updates" — resolves once the check settles. */
  check: () => Promise<void>
  /** Quits and installs the downloaded update. */
  install: () => Promise<void>
  isChecking: boolean
  isDownloading: boolean
}

const INITIAL_STATE: UpdaterState = { status: 'idle', currentVersion: '' }

/**
 * Subscribes to the main-process updater state (electron-updater over GitHub
 * Releases). Ephemeral, single-consumer state → plain React state, no Redux.
 */
export const useUpdater = (): UseUpdaterResult => {
  const [state, setState] = useState<UpdaterState>(INITIAL_STATE)

  useEffect(() => {
    let cancelled = false

    // Hydrate first: the app may have already found an update before this hook mounted.
    window.updater
      .getState()
      .then((current) => {
        if (!cancelled) setState(current)
      })
      .catch((error) => console.error('[useUpdater] Failed to read state:', error))

    const unsubscribe = window.updater.onStatus(setState)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const check = useCallback(async (): Promise<void> => {
    try {
      const next = await window.updater.check()
      setState(next)
    } catch (error) {
      console.error('[useUpdater] Check failed:', error)
    }
  }, [])

  const install = useCallback(async (): Promise<void> => {
    try {
      await window.updater.install()
    } catch (error) {
      console.error('[useUpdater] Install failed:', error)
    }
  }, [])

  return {
    state,
    check,
    install,
    isChecking: state.status === 'checking',
    isDownloading: state.status === 'downloading'
  }
}
