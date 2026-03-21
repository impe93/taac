/**
 * Audio IPC Handlers
 *
 * Handles IPC communication for audio recording and meeting note processing:
 * - Saving raw audio buffers to disk
 * - Triggering the post-processing pipeline (transcription, diarization, summarization)
 * - Cancelling in-progress processing
 * - Checking transcription model availability
 *
 * Reference: docs/NOTE_TAKER.md section §8
 */

import { ipcMain, app, BrowserWindow } from 'electron'
import { join, normalize } from 'path'
import fs from 'node:fs/promises'
import { convertToWav } from '../audio/audioConverter'
import { AudioManager } from '../audio/AudioManager'
import type { ProcessingProgress } from '../audio/types'

// AbortController for the active processing job
let activeProcessingAbort: AbortController | null = null

/**
 * §3.6 Path Validation — ensure the resolved path stays within the expected base directory.
 * Prevents directory-traversal attacks from renderer-supplied noteId / spaceId values.
 */
function validatePath(resolvedPath: string, baseDir: string): void {
  const normalizedBase = normalize(baseDir)
  const normalizedPath = normalize(resolvedPath)
  if (!normalizedPath.startsWith(normalizedBase + '/') && normalizedPath !== normalizedBase) {
    throw new Error(
      `[AudioHandlers] Path "${normalizedPath}" escapes the expected base directory "${normalizedBase}"`
    )
  }
}

export function registerAudioHandlers(): void {
  // Save raw audio buffers to {userData}/spaces/{spaceId}/assets/audio/{noteId}/
  // and immediately convert each track to 16 kHz mono WAV for the transcription pipeline.
  ipcMain.handle(
    'audio:saveRecording',
    async (
      _event,
      noteId: string,
      spaceId: string,
      data: { micAudio: Uint8Array; systemAudio?: Uint8Array; mode: 'remote' | 'in-person' }
    ): Promise<{
      micPath: string
      micWavPath: string
      systemPath?: string
      systemWavPath?: string
    }> => {
      try {
        const userData = app.getPath('userData')
        const spacesBase = join(userData, 'spaces')
        const audioDir = join(spacesBase, spaceId, 'assets', 'audio', noteId)

        // §3.6: guard against traversal in caller-supplied ids
        validatePath(audioDir, spacesBase)

        await fs.mkdir(audioDir, { recursive: true })

        // --- Microphone track ---
        const micPath = join(audioDir, 'mic.webm')
        await fs.writeFile(micPath, data.micAudio)
        console.log(`[AudioHandlers] Saved mic audio → ${micPath}`)

        const micWavPath = join(audioDir, 'mic.wav')
        await convertToWav(micPath, micWavPath)

        // --- System audio track (remote mode only) ---
        let systemPath: string | undefined
        let systemWavPath: string | undefined

        if (data.mode === 'remote' && data.systemAudio) {
          systemPath = join(audioDir, 'system.webm')
          await fs.writeFile(systemPath, data.systemAudio)
          console.log(`[AudioHandlers] Saved system audio → ${systemPath}`)

          systemWavPath = join(audioDir, 'system.wav')
          await convertToWav(systemPath, systemWavPath)
        }

        return { micPath, micWavPath, systemPath, systemWavPath }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`[AudioHandlers] Failed to save recording for note ${noteId}: ${message}`)
      }
    }
  )

  // Launch the post-processing pipeline via AudioManager
  ipcMain.handle(
    'audio:processRecording',
    async (
      _event,
      noteId: string,
      spaceId: string,
      micWavPath: string,
      systemWavPath: string | undefined,
      mode: 'remote' | 'in-person',
      recordingDate: string,
      durationSecs: number
    ): Promise<unknown> => {
      try {
        activeProcessingAbort = new AbortController()

        console.log(`[AudioHandlers] processRecording called for note ${noteId}`)

        const onProgress = (progress: ProcessingProgress): void => {
          // §5.2 / §8.3 — broadcast progress to all renderer windows
          BrowserWindow.getAllWindows().forEach((win) => {
            if (!win.webContents.isDestroyed()) {
              win.webContents.send('audio:processing-progress', { noteId, ...progress })
            }
          })
        }

        const metadata = await AudioManager.getInstance().processRecording(
          noteId,
          spaceId,
          micWavPath,
          systemWavPath,
          mode,
          recordingDate,
          durationSecs,
          onProgress
        )

        activeProcessingAbort = null
        return metadata
      } catch (error) {
        activeProcessingAbort = null
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(
          `[AudioHandlers] Failed to process recording for note ${noteId}: ${message}`
        )
      }
    }
  )

  // Cancel the active processing job
  ipcMain.handle('audio:cancelProcessing', async (_event, noteId: string): Promise<void> => {
    try {
      if (activeProcessingAbort) {
        activeProcessingAbort.abort()
        activeProcessingAbort = null
        console.log(`[AudioHandlers] Cancelled processing for note ${noteId}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`[AudioHandlers] Failed to cancel processing for note ${noteId}: ${message}`)
    }
  })

  // Check if the whisper transcription model is downloaded (stub)
  ipcMain.handle('audio:isTranscriptionModelDownloaded', async (): Promise<boolean> => {
    try {
      // TODO: resolve against ModelRegistry once whisper models are added
      console.log('[AudioHandlers] isTranscriptionModelDownloaded called (stub — returns false)')
      return false
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`[AudioHandlers] Failed to check transcription model status: ${message}`)
    }
  })
}
