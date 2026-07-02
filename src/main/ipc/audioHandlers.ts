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
import { configStore } from '../utils/configStore'
import { ModelRegistry } from '../ai/ModelRegistry'
import type { ProcessingProgress } from '../audio/types'
import type { Speaker, TranscriptionSegment, ActionItem } from '../../preload/types'

// AbortController for the active processing job
let activeProcessingAbort: AbortController | null = null

/**
 * Recording context stored after saveRecording, consumed by processRecording.
 * Avoids passing all parameters through the preload API.
 */
interface RecordingContext {
  micWavPath: string
  systemWavPath?: string
  micWebmPath: string
  systemWebmPath?: string
  mode: 'remote' | 'in-person'
  recordingDate: string
  durationSecs: number
  /** Requested spoken language: 'auto' or an ISO 639-1 code */
  requestedLanguage: string
}

const recordingContextMap = new Map<string, RecordingContext>()

function isDevApp(): boolean {
  return !app.isPackaged
}

function getAudioDir(noteId: string, spaceId: string): string {
  const userData = app.getPath('userData')
  const spacesBase = join(userData, 'spaces')
  const audioDir = join(spacesBase, spaceId, 'assets', 'audio', noteId)
  validatePath(audioDir, spacesBase)
  return audioDir
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Rebuild WAV tracks from preserved WebM files on disk (dev replay path).
 */
async function prepareRecordingContextFromDisk(
  noteId: string,
  spaceId: string,
  options: {
    mode: 'remote' | 'in-person'
    recordingDate: string
    durationSecs: number
    requestedLanguage: string
  },
  onConvertingProgress: (progress: number) => void
): Promise<RecordingContext> {
  const audioDir = getAudioDir(noteId, spaceId)
  const micWebmPath = join(audioDir, 'mic.webm')

  if (!(await fileExists(micWebmPath))) {
    throw new Error(
      `No saved microphone audio found at "${micWebmPath}". Enable "Keep audio recordings after transcription" and record again.`
    )
  }

  onConvertingProgress(10)
  const micWavPath = join(audioDir, 'mic.wav')
  await convertToWav(micWebmPath, micWavPath)
  onConvertingProgress(50)

  let systemWebmPath: string | undefined
  let systemWavPath: string | undefined

  if (options.mode === 'remote') {
    const candidateSystemWebm = join(audioDir, 'system.webm')
    if (await fileExists(candidateSystemWebm)) {
      systemWebmPath = candidateSystemWebm
      systemWavPath = join(audioDir, 'system.wav')
      await convertToWav(systemWebmPath, systemWavPath)
    }
  }

  onConvertingProgress(100)

  const durationSecs =
    options.durationSecs > 0 ? options.durationSecs : await getWavDurationSecs(micWavPath)

  return {
    micWavPath,
    systemWavPath,
    micWebmPath,
    systemWebmPath,
    mode: options.mode,
    recordingDate: options.recordingDate,
    durationSecs,
    requestedLanguage: options.requestedLanguage
  }
}

/** Stage index mapping for progress events */
const STAGE_INDEX: Record<string, number> = {
  converting: 1,
  transcribing: 2,
  diarizing: 3,
  summarizing: 4
}
const TOTAL_STAGES = 4

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

/**
 * Compute duration in seconds from a 16kHz mono 16-bit WAV file.
 * Falls back to 0 if the file cannot be read.
 */
async function getWavDurationSecs(wavPath: string): Promise<number> {
  try {
    const stats = await fs.stat(wavPath)
    // WAV header = 44 bytes, 16kHz * 1 channel * 2 bytes = 32000 bytes/sec
    const dataBytes = Math.max(0, stats.size - 44)
    return Math.round(dataBytes / 32000)
  } catch {
    return 0
  }
}

/**
 * Broadcast progress to all renderer windows, transforming the internal
 * ProcessingProgress format to the renderer's expected format.
 */
function broadcastProgress(noteId: string, progress: ProcessingProgress): void {
  const currentStage = STAGE_INDEX[progress.stage] ?? 0
  const rendererProgress = {
    noteId,
    stage: progress.stage,
    percentage: progress.progress,
    currentStage,
    totalStages: TOTAL_STAGES
  }

  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.webContents.isDestroyed()) {
      win.webContents.send('audio:processing-progress', rendererProgress)
    }
  })
}

/**
 * Clean up audio files after processing based on configuration.
 * §4.2: keepAudioAfterTranscription controls which files are retained.
 */
async function cleanupAudioFiles(context: RecordingContext): Promise<void> {
  const keepAudio = configStore.get('meeting').keepAudioAfterTranscription

  // Always delete temporary WAV files (they are conversion artifacts)
  const wavPaths = [context.micWavPath, context.systemWavPath].filter(Boolean) as string[]
  for (const p of wavPaths) {
    try {
      await fs.unlink(p)
      console.log(`[AudioHandlers] Deleted temp WAV: ${p}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[AudioHandlers] Could not delete temp WAV "${p}": ${msg}`)
    }
  }

  // Delete WebM originals if user chose not to keep audio
  if (!keepAudio) {
    const webmPaths = [context.micWebmPath, context.systemWebmPath].filter(Boolean) as string[]
    for (const p of webmPaths) {
      try {
        await fs.unlink(p)
        console.log(`[AudioHandlers] Deleted WebM: ${p}`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[AudioHandlers] Could not delete WebM "${p}": ${msg}`)
      }
    }
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
      data: {
        micAudio: Uint8Array
        systemAudio?: Uint8Array
        mode: 'remote' | 'in-person'
        durationSecs?: number
        /** Requested spoken language: 'auto' or an ISO 639-1 code */
        language?: string
      }
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

        // Store recording context for the subsequent processRecording call
        recordingContextMap.set(noteId, {
          micWavPath,
          systemWavPath,
          micWebmPath: micPath,
          systemWebmPath: systemPath,
          mode: data.mode,
          recordingDate: new Date().toISOString(),
          durationSecs: data.durationSecs ?? (await getWavDurationSecs(micWavPath)),
          requestedLanguage: data.language ?? 'auto'
        })

        return { micPath, micWavPath, systemPath, systemWavPath }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`[AudioHandlers] Failed to save recording for note ${noteId}: ${message}`)
      }
    }
  )

  // Launch the post-processing pipeline via AudioManager.
  // Uses the recording context stored by saveRecording — the renderer only needs to
  // pass noteId and spaceId.
  ipcMain.handle(
    'audio:processRecording',
    async (
      _event,
      noteId: string,
      spaceId: string
    ): Promise<{ metadata: unknown; content: string }> => {
      try {
        const context = recordingContextMap.get(noteId)
        if (!context) {
          throw new Error(
            `No recording context found for note ${noteId}. Was saveRecording called first?`
          )
        }

        activeProcessingAbort = new AbortController()

        console.log(`[AudioHandlers] processRecording called for note ${noteId}`)

        // Emit initial converting-done progress (conversion already happened in saveRecording)
        broadcastProgress(noteId, {
          stage: 'converting',
          progress: 100,
          message: 'Conversion complete'
        })

        const result = await AudioManager.getInstance().processRecording(
          noteId,
          spaceId,
          context.micWavPath,
          context.systemWavPath,
          context.mode,
          context.recordingDate,
          context.durationSecs,
          context.requestedLanguage,
          (progress: ProcessingProgress) => broadcastProgress(noteId, progress)
        )

        activeProcessingAbort = null

        // §4.2: Clean up audio files based on config
        await cleanupAudioFiles(context)

        // Remove consumed context
        recordingContextMap.delete(noteId)

        return result
      } catch (error) {
        activeProcessingAbort = null
        recordingContextMap.delete(noteId)
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
      // Clean up context for cancelled processing
      recordingContextMap.delete(noteId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`[AudioHandlers] Failed to cancel processing for note ${noteId}: ${message}`)
    }
  })

  // Check if a whisper.cpp (GGML) transcription model is downloaded.
  // GGML models are single .bin files stored directly under {userData}/models/.
  ipcMain.handle('audio:isTranscriptionModelDownloaded', async (): Promise<boolean> => {
    try {
      const modelsBase = join(app.getPath('userData'), 'models')
      const ggmlModels = ModelRegistry.getGgmlTranscriptionModels()
      for (const model of ggmlModels) {
        const exists = await fs
          .access(join(modelsBase, model.filename))
          .then(() => true)
          .catch(() => false)
        if (exists) return true
      }
      return false
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`[AudioHandlers] Failed to check transcription model status: ${message}`)
    }
  })

  ipcMain.handle(
    'audio:hasStoredRecording',
    async (_event, noteId: string, spaceId: string): Promise<boolean> => {
      try {
        const audioDir = getAudioDir(noteId, spaceId)
        return fileExists(join(audioDir, 'mic.webm'))
      } catch {
        return false
      }
    }
  )

  // Dev-only: re-run the full pipeline from preserved WebM files on disk.
  ipcMain.handle(
    'audio:reprocessFromDisk',
    async (
      _event,
      noteId: string,
      spaceId: string,
      options: {
        mode: 'remote' | 'in-person'
        recordingDate: string
        durationSecs: number
        language: string
      }
    ): Promise<{ metadata: unknown; content: string; summarizationError?: string }> => {
      if (!isDevApp()) {
        throw new Error('[AudioHandlers] reprocessFromDisk is only available in development builds')
      }

      try {
        activeProcessingAbort = new AbortController()

        const context = await prepareRecordingContextFromDisk(
          noteId,
          spaceId,
          {
            mode: options.mode,
            recordingDate: options.recordingDate,
            durationSecs: options.durationSecs,
            requestedLanguage: options.language
          },
          (pct) =>
            broadcastProgress(noteId, {
              stage: 'converting',
              progress: pct,
              message: 'Converting audio...'
            })
        )

        console.log(`[AudioHandlers] reprocessFromDisk called for note ${noteId}`)

        const result = await AudioManager.getInstance().processRecording(
          noteId,
          spaceId,
          context.micWavPath,
          context.systemWavPath,
          context.mode,
          context.recordingDate,
          context.durationSecs,
          context.requestedLanguage,
          (progress: ProcessingProgress) => broadcastProgress(noteId, progress)
        )

        activeProcessingAbort = null
        await cleanupAudioFiles(context)

        return result
      } catch (error) {
        activeProcessingAbort = null
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(
          `[AudioHandlers] Failed to reprocess recording from disk for note ${noteId}: ${message}`
        )
      }
    }
  )

  // Re-run summarization on an already-transcribed meeting in a chosen language
  // (recovery path when auto-detection got the language wrong).
  ipcMain.handle(
    'audio:regenerateSummary',
    async (
      _event,
      payload: { speakers: Speaker[]; transcription: TranscriptionSegment[]; language: string }
    ): Promise<{
      content: string
      actionItems: ActionItem[]
      language: string
      summarizationError?: string
    }> => {
      try {
        return await AudioManager.getInstance().regenerateSummary(
          payload.speakers,
          payload.transcription,
          payload.language
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`[AudioHandlers] Failed to regenerate summary: ${message}`)
      }
    }
  )
}
