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

import { ipcMain, app } from 'electron'
import { join } from 'path'
import fs from 'node:fs/promises'

// AbortController for the active processing job
let activeProcessingAbort: AbortController | null = null

export function registerAudioHandlers(): void {
  // Save raw audio buffers to {userData}/spaces/{spaceId}/assets/audio/{noteId}/
  ipcMain.handle(
    'audio:saveRecording',
    async (
      _event,
      noteId: string,
      spaceId: string,
      data: { micAudio: Uint8Array; systemAudio?: Uint8Array; mode: 'remote' | 'in-person' }
    ): Promise<{ micPath: string; systemPath?: string }> => {
      try {
        const audioDir = join(app.getPath('userData'), 'spaces', spaceId, 'assets', 'audio', noteId)
        await fs.mkdir(audioDir, { recursive: true })

        const micPath = join(audioDir, 'mic.webm')
        await fs.writeFile(micPath, data.micAudio)
        console.log(`[AudioHandlers] Saved mic audio to ${micPath}`)

        let systemPath: string | undefined
        if (data.mode === 'remote' && data.systemAudio) {
          systemPath = join(audioDir, 'system.webm')
          await fs.writeFile(systemPath, data.systemAudio)
          console.log(`[AudioHandlers] Saved system audio to ${systemPath}`)
        }

        return { micPath, systemPath }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`[AudioHandlers] Failed to save recording for note ${noteId}: ${message}`)
      }
    }
  )

  // Launch the post-processing pipeline (stub — full impl in a later task)
  ipcMain.handle(
    'audio:processRecording',
    async (_event, noteId: string, _spaceId: string): Promise<unknown> => {
      try {
        activeProcessingAbort = new AbortController()
        console.log(`[AudioHandlers] processRecording called for note ${noteId} (stub)`)
        // TODO: implement full pipeline (conversion → transcription → diarization → summarization)
        return null
      } catch (error) {
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
