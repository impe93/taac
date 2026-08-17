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
import { isAbsolute, join, relative, resolve, sep } from 'path'
import fs from 'node:fs/promises'
import { convertToWav } from '../audio/audioConverter'
import { AudioManager } from '../audio/AudioManager'
import { configStore } from '../utils/configStore'
import { ModelRegistry } from '../ai/ModelRegistry'
import { RealtimeTranscriptionService } from '../audio/realtime/RealtimeTranscriptionService'
import { checkRealtimeAvailability } from '../audio/realtime/availability'
import type { RealtimeAvailability } from '../audio/realtime/availability'
import type { RealtimeSessionResult, RealtimeTrack } from '../audio/realtime/types'
import type { ProcessingProgress } from '../audio/types'
import type {
  Speaker,
  TranscriptionSegment,
  ActionItem,
  MeetingMetadata,
  ReprocessRecordingOptions
} from '../../preload/types'

interface ActiveProcessingJob {
  noteId: string
  controller: AbortController
}

// AudioManager owns native/AI resources that must only serve one pipeline at a time.
let activeProcessingJob: ActiveProcessingJob | null = null

/**
 * Recording context stored after saveRecording, consumed by processRecording.
 * Avoids passing all parameters through the preload API.
 */
interface RecordingContext {
  micWavPath: string
  systemWavPath?: string
  micWebmPath: string
  systemWebmPath?: string
  mode: 'remote' | 'in-person' | 'system-only'
  /** Meeting (default) or listened media — drives the summary structure. */
  contentType: 'meeting' | 'media'
  /** Per-recording summary length override; undefined → global meeting.summaryDepth. */
  summaryDepth?: 'conservative' | 'balanced' | 'aggressive'
  recordingDate: string
  durationSecs: number
  /** Requested spoken language: 'auto' or an ISO 639-1 code */
  requestedLanguage: string
}

const recordingContextMap = new Map<string, RecordingContext>()

/**
 * Transcripts produced live during recording, keyed by noteId.
 * Stored by audio:realtime:stop and consumed by audio:processRecording so the
 * pipeline can skip whisper transcription entirely.
 */
const realtimeResults = new Map<string, RealtimeSessionResult>()

function isDevApp(): boolean {
  return !app.isPackaged
}

function beginProcessingJob(noteId: string): ActiveProcessingJob {
  if (activeProcessingJob) {
    throw new Error(
      `Another recording is already being processed (${activeProcessingJob.noteId}). Try again when it finishes.`
    )
  }

  const job = { noteId, controller: new AbortController() }
  activeProcessingJob = job
  return job
}

function finishProcessingJob(job: ActiveProcessingJob): void {
  if (activeProcessingJob === job) activeProcessingJob = null
}

function validateStorageId(value: string, label: string): void {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value === '.' ||
    value === '..' ||
    value.includes('/') ||
    value.includes('\\')
  ) {
    throw new Error(`[AudioHandlers] Invalid ${label}`)
  }
}

function validateReprocessOptions(options: ReprocessRecordingOptions): void {
  const modes = new Set(['remote', 'in-person', 'system-only'])
  const contentTypes = new Set(['meeting', 'media'])
  const summaryDepths = new Set(['conservative', 'balanced', 'aggressive'])

  if (!options || !modes.has(options.mode)) {
    throw new Error('[AudioHandlers] Invalid recording mode')
  }
  if (options.contentType !== undefined && !contentTypes.has(options.contentType)) {
    throw new Error('[AudioHandlers] Invalid content type')
  }
  if (options.contentType === 'media' && options.mode !== 'system-only') {
    throw new Error('[AudioHandlers] Media reprocessing requires system-only audio')
  }
  if (options.summaryDepth !== undefined && !summaryDepths.has(options.summaryDepth)) {
    throw new Error('[AudioHandlers] Invalid summary depth')
  }
  if (!Number.isFinite(options.durationSecs) || options.durationSecs < 0) {
    throw new Error('[AudioHandlers] Invalid recording duration')
  }
  if (!options.recordingDate || Number.isNaN(Date.parse(options.recordingDate))) {
    throw new Error('[AudioHandlers] Invalid recording date')
  }
  if (!/^auto$|^[a-z]{2}$/i.test(options.language)) {
    throw new Error('[AudioHandlers] Invalid meeting language')
  }
}

function getAudioDir(noteId: string, spaceId: string): string {
  validateStorageId(noteId, 'note ID')
  validateStorageId(spaceId, 'space ID')
  const userData = app.getPath('userData')
  const spacesBase = join(userData, 'spaces')
  const audioDir = join(spacesBase, spaceId, 'assets', 'audio', noteId)
  validatePath(audioDir, spacesBase)
  return audioDir
}

async function isUsableFile(path: string): Promise<boolean> {
  try {
    const stats = await fs.stat(path)
    return stats.isFile() && stats.size > 0
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
  options: ReprocessRecordingOptions,
  onConvertingProgress: (progress: number) => void
): Promise<RecordingContext> {
  const audioDir = getAudioDir(noteId, spaceId)
  const micWebmPath = join(audioDir, 'mic.webm')
  const micWavPath = join(audioDir, 'mic.wav')
  const systemWebmPath = options.mode === 'remote' ? join(audioDir, 'system.webm') : undefined
  const systemWavPath = options.mode === 'remote' ? join(audioDir, 'system.wav') : undefined

  if (!(await isUsableFile(micWebmPath))) {
    throw new Error(
      'The saved primary audio is missing or empty. Keep the original recording and try again.'
    )
  }
  if (systemWebmPath && !(await isUsableFile(systemWebmPath))) {
    throw new Error('The saved system audio is missing or empty for this remote meeting.')
  }

  try {
    onConvertingProgress(10)
    await convertToWav(micWebmPath, micWavPath)
    onConvertingProgress(50)

    if (systemWebmPath && systemWavPath) {
      await convertToWav(systemWebmPath, systemWavPath)
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
      contentType: options.contentType ?? 'meeting',
      summaryDepth: options.summaryDepth,
      recordingDate: options.recordingDate,
      durationSecs,
      requestedLanguage: options.language
    }
  } catch (error) {
    await cleanupTemporaryWavPaths([micWavPath, systemWavPath])
    throw error
  }
}

/** Pipeline stages in order — the realtime path has no transcribing stage */
const DEFAULT_STAGES = ['converting', 'transcribing', 'diarizing', 'summarizing'] as const
const REALTIME_STAGES = ['converting', 'diarizing', 'summarizing'] as const

/**
 * §3.6 Path Validation — ensure the resolved path stays within the expected base directory.
 * Prevents directory-traversal attacks from renderer-supplied noteId / spaceId values.
 */
function validatePath(resolvedPath: string, baseDir: string): void {
  const normalizedBase = resolve(baseDir)
  const normalizedPath = resolve(resolvedPath)
  const relativePath = relative(normalizedBase, normalizedPath)
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
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
 *
 * @param stages  Ordered stage list for this pipeline run — differs between
 *                the whisper path (4 stages) and the realtime path (3 stages)
 */
function broadcastProgress(
  noteId: string,
  progress: ProcessingProgress,
  stages: readonly string[] = DEFAULT_STAGES
): void {
  const stageIndex = stages.indexOf(progress.stage)
  const rendererProgress = {
    noteId,
    stage: progress.stage,
    percentage: progress.progress,
    currentStage: stageIndex >= 0 ? stageIndex + 1 : 0,
    totalStages: stages.length,
    stages: [...stages]
  }

  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.webContents.isDestroyed()) {
      win.webContents.send('audio:processing-progress', rendererProgress)
    }
  })
}

async function cleanupTemporaryWavPaths(paths: Array<string | undefined>): Promise<void> {
  for (const path of paths) {
    if (!path) continue
    try {
      await fs.unlink(path)
      console.log(`[AudioHandlers] Deleted temp WAV: ${path}`)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[AudioHandlers] Could not delete temp WAV "${path}": ${msg}`)
    }
  }
}

async function cleanupTemporaryWavs(context: RecordingContext): Promise<void> {
  await cleanupTemporaryWavPaths([context.micWavPath, context.systemWavPath])
}

/**
 * Clean up audio files after a newly captured recording succeeds.
 * Developer replays deliberately call cleanupTemporaryWavs instead so the
 * preserved WebM source can be replayed again regardless of current settings.
 */
async function cleanupCapturedAudioFiles(context: RecordingContext): Promise<void> {
  await cleanupTemporaryWavs(context)

  const keepAudio = configStore.get('meeting').keepAudioAfterTranscription

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

/**
 * Coerce an IPC payload (ArrayBuffer or any typed-array view) into Int16Array.
 * Always copies into a fresh buffer: Electron delivers pooled Buffers whose
 * byteOffset can be odd, which would make an Int16Array view throw.
 */
function toInt16Array(payload: ArrayBuffer | ArrayBufferView): Int16Array {
  const view =
    payload instanceof ArrayBuffer
      ? new Uint8Array(payload)
      : new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength)
  const copy = new Uint8Array(view.length - (view.length % 2))
  copy.set(view.subarray(0, copy.length))
  return new Int16Array(copy.buffer)
}

export function registerAudioHandlers(): void {
  // ---------------------------------------------------------------------
  // Realtime transcription (macOS Apple Silicon — Qwen3-ASR MLX sidecar)
  // ---------------------------------------------------------------------

  ipcMain.handle('audio:isRealtimeAvailable', async (): Promise<RealtimeAvailability> => {
    return checkRealtimeAvailability()
  })

  // Start a live transcription session for a recording. Never blocks
  // recording: failures return { available: false } and the pipeline
  // falls back to whisper post-processing.
  ipcMain.handle(
    'audio:realtime:start',
    async (
      _event,
      noteId: string,
      options: { hasSystemTrack: boolean; language: string }
    ): Promise<RealtimeAvailability> => {
      const availability = await checkRealtimeAvailability()
      if (!availability.available) {
        console.log(`[AudioHandlers] Realtime transcription unavailable: ${availability.reason}`)
        return availability
      }

      try {
        await RealtimeTranscriptionService.getInstance().startSession({
          noteId,
          hasSystemTrack: options.hasSystemTrack,
          language: options.language ?? 'auto'
        })
        return { available: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[AudioHandlers] Failed to start realtime session: ${message}`)
        return { available: false, reason: 'python-runtime-missing' }
      }
    }
  )

  // PCM chunk stream — fire-and-forget (≈32 KB/s per track, no backpressure
  // concern; an invoke round-trip per chunk would be pure overhead).
  ipcMain.on(
    'audio:realtime:pcm',
    (_event, noteId: string, track: RealtimeTrack, pcm: ArrayBuffer | ArrayBufferView): void => {
      try {
        RealtimeTranscriptionService.getInstance().pushPcm(noteId, track, toInt16Array(pcm))
      } catch (error) {
        // A PCM/VAD failure must never crash the main process — but it must be
        // loud: a repeated error here means live segments are being lost.
        console.error(`[AudioHandlers] Realtime PCM processing error (${track}):`, error)
      }
    }
  )

  // Stop the live session and stash its transcript for processRecording.
  ipcMain.handle(
    'audio:realtime:stop',
    async (_event, noteId: string): Promise<{ hasTranscript: boolean }> => {
      try {
        const result = await RealtimeTranscriptionService.getInstance().finishSession(noteId)
        if (result) {
          realtimeResults.set(noteId, result)
          return { hasTranscript: true }
        }
        return { hasTranscript: false }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[AudioHandlers] Failed to stop realtime session: ${message}`)
        return { hasTranscript: false }
      }
    }
  )

  // Abort the live session, discarding everything (recording error paths).
  ipcMain.handle('audio:realtime:abort', async (_event, noteId: string): Promise<void> => {
    await RealtimeTranscriptionService.getInstance().abortSession(noteId)
    realtimeResults.delete(noteId)
  })

  // Save raw audio buffers to {userData}/spaces/{spaceId}/assets/audio/{noteId}/
  // and immediately convert each track to 16 kHz mono WAV for the transcription pipeline.
  ipcMain.handle(
    'audio:saveRecording',
    async (
      _event,
      noteId: string,
      spaceId: string,
      data: {
        micAudio?: Uint8Array
        systemAudio?: Uint8Array
        mode: 'remote' | 'in-person' | 'system-only'
        contentType?: 'meeting' | 'media'
        summaryDepth?: 'conservative' | 'balanced' | 'aggressive'
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

        // --- Primary track ---
        // Always carried in `micAudio`. For meeting modes this is the microphone;
        // for system-only the renderer captures the system audio into the same
        // primary slot (there is no mic), so the whole downstream mono-track
        // pipeline (diarization on the primary WAV) works unchanged. The primary
        // file is always named mic.* on disk.
        const primaryAudio = data.micAudio
        if (!primaryAudio) {
          throw new Error('No primary audio captured for this recording.')
        }

        const micPath = join(audioDir, 'mic.webm')
        await fs.writeFile(micPath, primaryAudio)
        console.log(`[AudioHandlers] Saved primary (${data.mode}) audio → ${micPath}`)

        const micWavPath = join(audioDir, 'mic.wav')
        await convertToWav(micPath, micWavPath)

        // --- Second system audio track (remote mode only, alongside the mic) ---
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
          contentType: data.contentType ?? 'meeting',
          summaryDepth: data.summaryDepth,
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
    ): Promise<{
      metadata: MeetingMetadata
      content: string
      processingError?: string
      summarizationError?: string
    }> => {
      let job: ActiveProcessingJob | null = null
      let context: RecordingContext | null = null
      let completed = false

      try {
        context = recordingContextMap.get(noteId) ?? null
        if (!context) {
          throw new Error(
            `No recording context found for note ${noteId}. Was saveRecording called first?`
          )
        }

        // Acquire only after locating the context. If another job is active, leave
        // this context untouched so the renderer queue may retry it later.
        job = beginProcessingJob(noteId)

        // Transcript produced live during recording (undefined → whisper path)
        const realtime = realtimeResults.get(noteId)
        realtimeResults.delete(noteId)
        const stages = realtime ? REALTIME_STAGES : DEFAULT_STAGES

        console.log(
          `[AudioHandlers] processRecording called for note ${noteId}` +
            (realtime ? ' (using realtime transcript)' : '')
        )

        // Emit initial converting-done progress (conversion already happened in saveRecording)
        broadcastProgress(
          noteId,
          {
            stage: 'converting',
            progress: 100,
            message: 'Conversion complete'
          },
          stages
        )

        const result = await AudioManager.getInstance().processRecording(
          noteId,
          spaceId,
          context.micWavPath,
          context.systemWavPath,
          context.mode,
          context.recordingDate,
          context.durationSecs,
          context.requestedLanguage,
          context.contentType,
          context.summaryDepth,
          (progress: ProcessingProgress) => broadcastProgress(noteId, progress, stages),
          realtime,
          job.controller.signal
        )

        completed = true
        return result
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(
          `[AudioHandlers] Failed to process recording for note ${noteId}: ${message}`
        )
      } finally {
        if (job && context) {
          try {
            if (completed) await cleanupCapturedAudioFiles(context)
            else await cleanupTemporaryWavs(context)
          } finally {
            recordingContextMap.delete(noteId)
            realtimeResults.delete(noteId)
            finishProcessingJob(job)
          }
        }
      }
    }
  )

  // Cancel the active processing job
  ipcMain.handle('audio:cancelProcessing', async (_event, noteId: string): Promise<void> => {
    try {
      if (activeProcessingJob?.noteId === noteId) {
        activeProcessingJob.controller.abort()
        console.log(`[AudioHandlers] Cancelled processing for note ${noteId}`)
      }
      // Clean up context for cancelled processing
      recordingContextMap.delete(noteId)
      realtimeResults.delete(noteId)
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
    async (
      _event,
      noteId: string,
      spaceId: string,
      mode: 'remote' | 'in-person' | 'system-only'
    ): Promise<boolean> => {
      if (!isDevApp()) return false

      try {
        if (!['remote', 'in-person', 'system-only'].includes(mode)) return false
        const audioDir = getAudioDir(noteId, spaceId)
        const hasPrimary = await isUsableFile(join(audioDir, 'mic.webm'))
        if (!hasPrimary) return false
        return mode !== 'remote' || isUsableFile(join(audioDir, 'system.webm'))
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
      options: ReprocessRecordingOptions
    ): Promise<{
      metadata: MeetingMetadata
      content: string
      processingError?: string
      summarizationError?: string
    }> => {
      if (!isDevApp()) {
        throw new Error('[AudioHandlers] reprocessFromDisk is only available in development builds')
      }

      validateStorageId(noteId, 'note ID')
      validateStorageId(spaceId, 'space ID')
      validateReprocessOptions(options)

      let job: ActiveProcessingJob | null = null
      let context: RecordingContext | null = null

      try {
        job = beginProcessingJob(noteId)

        context = await prepareRecordingContextFromDisk(noteId, spaceId, options, (pct) =>
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
          context.contentType,
          context.summaryDepth,
          (progress: ProcessingProgress) => broadcastProgress(noteId, progress),
          undefined,
          job.controller.signal
        )

        return result
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(
          `[AudioHandlers] Failed to reprocess recording from disk for note ${noteId}: ${message}`
        )
      } finally {
        try {
          if (context) await cleanupTemporaryWavs(context)
        } finally {
          if (job) finishProcessingJob(job)
        }
      }
    }
  )

  // Re-run summarization on an already-transcribed meeting in a chosen language
  // (recovery path when auto-detection got the language wrong).
  ipcMain.handle(
    'audio:regenerateSummary',
    async (
      _event,
      payload: {
        speakers: Speaker[]
        transcription: TranscriptionSegment[]
        language: string
        contentType?: 'meeting' | 'media'
        summaryDepth?: 'conservative' | 'balanced' | 'aggressive'
      }
    ): Promise<{
      content: string
      actionItems: ActionItem[]
      language: string
      // Speaker names are resolved from the transcript during summarization, so
      // the caller must persist these back into the note's metadata.
      speakers: Speaker[]
      transcription: TranscriptionSegment[]
      summarizationError?: string
    }> => {
      try {
        return await AudioManager.getInstance().regenerateSummary(
          payload.speakers,
          payload.transcription,
          payload.language,
          payload.contentType ?? 'meeting',
          payload.summaryDepth
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`[AudioHandlers] Failed to regenerate summary: ${message}`)
      }
    }
  )
}
