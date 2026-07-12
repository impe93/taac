import { createContext, useContext } from 'react'
import type { DownloadProgress } from '@main/ai/types'

/**
 * Shape shared by every download consumer (onboarding, settings, the top-bar
 * indicator). Mirrors the legacy `useModelDownload()` return so existing callers
 * keep working, but the progress `Map` and mutations now live in a single
 * app-wide provider (`DownloadProvider`) instead of per-component state.
 */
export interface DownloadContextValue {
  progress: Map<string, DownloadProgress>
  download: (modelId: string) => void
  downloadAsync: (modelId: string) => Promise<unknown>
  pause: (modelId: string) => void
  pauseAsync: (modelId: string) => Promise<unknown>
  resume: (modelId: string) => void
  resumeAsync: (modelId: string) => Promise<unknown>
  cancel: (modelId: string) => void
  cancelAsync: (modelId: string) => Promise<unknown>
  isDownloading: boolean
  isPausing: boolean
  isResuming: boolean
  isCanceling: boolean
}

export const DownloadContext = createContext<DownloadContextValue | null>(null)

/**
 * Access the app-wide download state. Throws if used outside `DownloadProvider`.
 */
export const useDownloadContext = (): DownloadContextValue => {
  const ctx = useContext(DownloadContext)
  if (!ctx) {
    throw new Error('useDownloadContext must be used within a DownloadProvider')
  }
  return ctx
}
