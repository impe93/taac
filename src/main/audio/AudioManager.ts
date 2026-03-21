/**
 * AudioManager - Singleton Orchestrator for Meeting Audio Pipeline
 *
 * Coordinates the full post-processing pipeline for meeting notes:
 *   1. (Conversion already done in audioHandlers before processRecording is called)
 *   2. Transcription via TranscriptionService (stub — real impl in a later task)
 *   3. Diarization via DiarizationService (stub — real impl in a later task)
 *   4. Timeline merge + speaker label assignment
 *   5. Summarization via AIManager (stub — real impl in a later task)
 *   6. Construction of the MeetingMetadata result object
 *
 * §3.1  Singleton with private constructor + getInstance()
 * §3.3  initialize() is idempotent (guarded by this.initialized)
 * §3.4  dispose() tears down sub-services and resets state
 * §3.7  All log lines are prefixed with [AudioManager]
 *
 * Reference: docs/NOTE_TAKER.md section §11
 */

import { join } from 'node:path'
import { app } from 'electron'
import fs from 'node:fs/promises'
import type {
  MeetingMetadata,
  Speaker,
  TranscriptionSegment,
  ActionItem
} from '../../preload/types'
import type {
  ProcessingProgress,
  TranscriptionResult,
  DiarizationResult,
  DiarizationSegment
} from './types'
import { TranscriptionService } from './TranscriptionService'
import { DiarizationService } from './DiarizationService'

// ---------------------------------------------------------------------------
// AudioManager
// ---------------------------------------------------------------------------

export class AudioManager {
  private static instance: AudioManager | null = null
  private initialized = false
  private transcriptionService: TranscriptionService | null = null
  private diarizationService: DiarizationService | null = null

  private constructor() {}

  // §3.1 — singleton access
  static getInstance(): AudioManager {
    if (!AudioManager.instance) {
      AudioManager.instance = new AudioManager()
    }
    return AudioManager.instance
  }

  // §3.3 — idempotent initialization
  async initialize(): Promise<void> {
    if (this.initialized) return

    console.log('[AudioManager] Initializing...')

    // Default whisper model directory: {userData}/models/whisper-small-onnx
    // Users download the model via the model management UI before recording.
    const defaultWhisperModelDir = join(app.getPath('userData'), 'models', 'whisper-small-onnx')

    this.transcriptionService = new TranscriptionService()
    await this.transcriptionService.initialize(defaultWhisperModelDir)

    // Default diarization model paths: {userData}/models/diarization/
    // Models are bundled with the app or auto-downloaded during onboarding (§7.3).
    const diarizationModelDir = join(app.getPath('userData'), 'models', 'diarization')
    const segmentationModelPath = join(diarizationModelDir, 'segmentation.onnx')
    const embeddingModelPath = join(diarizationModelDir, 'embedding.onnx')

    this.diarizationService = new DiarizationService()
    await this.diarizationService.initialize(segmentationModelPath, embeddingModelPath)

    this.initialized = true
    console.log('[AudioManager] Initialized')
  }

  // §3.4 — full cleanup
  async dispose(): Promise<void> {
    console.log('[AudioManager] Disposing...')
    this.transcriptionService?.dispose()
    this.diarizationService?.dispose()
    this.transcriptionService = null
    this.diarizationService = null
    this.initialized = false
    console.log('[AudioManager] Disposed')
  }

  /**
   * Run the full post-processing pipeline for a meeting recording.
   *
   * The WAV files must already exist on disk (conversion is done in audioHandlers
   * as part of audio:saveRecording before this method is called).
   *
   * @param noteId        Unique note identifier
   * @param spaceId       Space identifier (used for path construction / cleanup)
   * @param micWavPath    Absolute path to the 16 kHz mono WAV for the mic track
   * @param systemWavPath Absolute path to the 16 kHz mono WAV for the system track (remote only)
   * @param mode          Recording mode ('remote' | 'in-person')
   * @param recordingDate ISO 8601 timestamp of when the recording started
   * @param durationSecs  Duration of the recording in seconds
   * @param onProgress    Progress callback; called at each pipeline stage
   */
  async processRecording(
    noteId: string,
    spaceId: string,
    micWavPath: string,
    systemWavPath: string | undefined,
    mode: 'remote' | 'in-person',
    recordingDate: string,
    durationSecs: number,
    onProgress: (progress: ProcessingProgress) => void
  ): Promise<MeetingMetadata> {
    await this.initialize()

    console.log(`[AudioManager] processRecording — note=${noteId} space=${spaceId} mode=${mode}`)

    // ------------------------------------------------------------------
    // Stage 1: Transcription
    // ------------------------------------------------------------------
    onProgress({ stage: 'transcribing', progress: 0, message: 'Transcribing audio...' })
    console.log('[AudioManager] Stage: transcribing')

    const micTranscription = await this.transcriptionService!.transcribe(micWavPath)

    let systemTranscription: TranscriptionResult | null = null
    if (mode === 'remote' && systemWavPath) {
      onProgress({ stage: 'transcribing', progress: 50, message: 'Transcribing system audio...' })
      systemTranscription = await this.transcriptionService!.transcribe(systemWavPath)
    }

    onProgress({ stage: 'transcribing', progress: 100, message: 'Transcription complete' })

    // ------------------------------------------------------------------
    // Stage 2: Diarization
    // ------------------------------------------------------------------
    onProgress({ stage: 'diarizing', progress: 0, message: 'Identifying speakers...' })
    console.log('[AudioManager] Stage: diarizing')

    const micDiarization = await this.diarizationService!.diarize(micWavPath)

    let systemDiarization: DiarizationResult | null = null
    if (mode === 'remote' && systemWavPath) {
      onProgress({ stage: 'diarizing', progress: 50, message: 'Identifying remote speakers...' })
      systemDiarization = await this.diarizationService!.diarize(systemWavPath)
    }

    onProgress({ stage: 'diarizing', progress: 100, message: 'Speaker identification complete' })

    // ------------------------------------------------------------------
    // Stage 3: Merge timelines + assign speaker labels
    // ------------------------------------------------------------------
    const { speakers, transcriptionSegments } = this.buildTimeline(
      mode,
      micTranscription,
      micDiarization,
      systemTranscription,
      systemDiarization
    )

    // ------------------------------------------------------------------
    // Stage 4: Summarization (stub)
    // ------------------------------------------------------------------
    onProgress({ stage: 'summarizing', progress: 0, message: 'Generating summary...' })
    console.log('[AudioManager] Stage: summarizing (stub)')

    // Stub: real implementation will call AIManager.generateChatCompletion()
    // with the formatted transcript and return structured markdown + action items.
    const actionItems: ActionItem[] = []

    onProgress({ stage: 'summarizing', progress: 100, message: 'Summary complete' })

    // ------------------------------------------------------------------
    // Stage 5: Cleanup temporary WAV files
    // ------------------------------------------------------------------
    await this.cleanupWavFiles(micWavPath, systemWavPath)

    // ------------------------------------------------------------------
    // Build and return MeetingMetadata
    // ------------------------------------------------------------------
    const detectedLanguage =
      micTranscription.detectedLanguage || systemTranscription?.detectedLanguage || 'en'

    const metadata: MeetingMetadata = {
      recordingMode: mode,
      duration: durationSecs,
      language: detectedLanguage,
      recordingDate,
      speakers,
      transcription: transcriptionSegments,
      actionItems
    }

    console.log('[AudioManager] processRecording complete')
    onProgress({ stage: 'done', progress: 100, message: 'Processing complete' })

    return metadata
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Merge mic and system timelines, then assign human-readable speaker labels.
   *
   * Remote mode (§5.6):
   *   - Mic speakers  → "You" (mic speakers are treated as the local user)
   *   - System speakers → "Speaker 1", "Speaker 2", …
   *   - Segments from both tracks are merged chronologically by startTime
   *
   * In-person mode (§5.7):
   *   - Single mic track, all identified speakers → "Speaker 1", "Speaker 2", …
   */
  private buildTimeline(
    mode: 'remote' | 'in-person',
    micTranscription: TranscriptionResult,
    micDiarization: DiarizationResult,
    systemTranscription: TranscriptionResult | null,
    systemDiarization: DiarizationResult | null
  ): { speakers: Speaker[]; transcriptionSegments: TranscriptionSegment[] } {
    if (mode === 'remote') {
      return this.buildRemoteTimeline(
        micTranscription,
        micDiarization,
        systemTranscription,
        systemDiarization
      )
    } else {
      return this.buildInPersonTimeline(micTranscription, micDiarization)
    }
  }

  /**
   * Remote mode: mic track speakers = "You", system track speakers = "Speaker N".
   * Segments are merged and sorted chronologically.
   */
  private buildRemoteTimeline(
    micTranscription: TranscriptionResult,
    micDiarization: DiarizationResult,
    systemTranscription: TranscriptionResult | null,
    systemDiarization: DiarizationResult | null
  ): { speakers: Speaker[]; transcriptionSegments: TranscriptionSegment[] } {
    const speakersMap = new Map<string, Speaker>()

    // Mic speaker(s) labelled "You" (or "You (N)" if multiple speakers on mic track)
    const micSpeakerIdxToId = new Map<number, string>()
    for (let i = 0; i < micDiarization.numSpeakers; i++) {
      const speakerId = `speaker-mic-${i}`
      const label = micDiarization.numSpeakers === 1 ? 'You' : `You (${i + 1})`
      speakersMap.set(speakerId, { id: speakerId, label, totalSpeakingTime: 0 })
      micSpeakerIdxToId.set(i, speakerId)
    }

    // System speaker(s) labelled "Speaker 1", "Speaker 2", …
    const sysSpeakerIdxToId = new Map<number, string>()
    if (systemDiarization) {
      for (let i = 0; i < systemDiarization.numSpeakers; i++) {
        const speakerId = `speaker-sys-${i}`
        const label = `Speaker ${i + 1}`
        speakersMap.set(speakerId, { id: speakerId, label, totalSpeakingTime: 0 })
        sysSpeakerIdxToId.set(i, speakerId)
      }
    }

    const segments: TranscriptionSegment[] = []

    // Assign mic transcription segments to diarized speakers
    for (const seg of micTranscription.segments) {
      const diarSeg = this.findDiarizationSegment(micDiarization.segments, seg.startTime)
      const speakerId = micSpeakerIdxToId.get(diarSeg?.speaker ?? 0) ?? 'speaker-mic-0'
      const duration = seg.endTime - seg.startTime
      const speaker = speakersMap.get(speakerId)
      if (speaker) speaker.totalSpeakingTime += duration
      segments.push({ speakerId, startTime: seg.startTime, endTime: seg.endTime, text: seg.text })
    }

    // Assign system transcription segments to diarized speakers
    if (systemTranscription && systemDiarization) {
      for (const seg of systemTranscription.segments) {
        const diarSeg = this.findDiarizationSegment(systemDiarization.segments, seg.startTime)
        const speakerId = sysSpeakerIdxToId.get(diarSeg?.speaker ?? 0) ?? 'speaker-sys-0'
        const duration = seg.endTime - seg.startTime
        const speaker = speakersMap.get(speakerId)
        if (speaker) speaker.totalSpeakingTime += duration
        segments.push({ speakerId, startTime: seg.startTime, endTime: seg.endTime, text: seg.text })
      }
    }

    // Sort merged segments chronologically
    segments.sort((a, b) => a.startTime - b.startTime)

    return { speakers: Array.from(speakersMap.values()), transcriptionSegments: segments }
  }

  /**
   * In-person mode: single mic track, all speakers labelled "Speaker N".
   */
  private buildInPersonTimeline(
    micTranscription: TranscriptionResult,
    micDiarization: DiarizationResult
  ): { speakers: Speaker[]; transcriptionSegments: TranscriptionSegment[] } {
    const speakersMap = new Map<string, Speaker>()
    const speakerIdxToId = new Map<number, string>()

    for (let i = 0; i < micDiarization.numSpeakers; i++) {
      const speakerId = `speaker-${i}`
      const label = `Speaker ${i + 1}`
      speakersMap.set(speakerId, { id: speakerId, label, totalSpeakingTime: 0 })
      speakerIdxToId.set(i, speakerId)
    }

    const segments: TranscriptionSegment[] = micTranscription.segments.map((seg) => {
      const diarSeg = this.findDiarizationSegment(micDiarization.segments, seg.startTime)
      const speakerId = speakerIdxToId.get(diarSeg?.speaker ?? 0) ?? 'speaker-0'
      const duration = seg.endTime - seg.startTime
      const speaker = speakersMap.get(speakerId)
      if (speaker) speaker.totalSpeakingTime += duration
      return { speakerId, startTime: seg.startTime, endTime: seg.endTime, text: seg.text }
    })

    return { speakers: Array.from(speakersMap.values()), transcriptionSegments: segments }
  }

  /**
   * Find the diarization segment that covers the given timestamp.
   * Returns the first overlapping segment, or null if none found.
   */
  private findDiarizationSegment(
    segments: DiarizationSegment[],
    timestamp: number
  ): DiarizationSegment | null {
    return segments.find((s) => s.startTime <= timestamp && timestamp < s.endTime) ?? null
  }

  /**
   * Delete temporary WAV files produced by the audio conversion step.
   * WebM originals are retained (config-controlled cleanup is a later task, §4.2).
   */
  private async cleanupWavFiles(
    micWavPath: string,
    systemWavPath: string | undefined
  ): Promise<void> {
    const paths = [micWavPath, systemWavPath].filter(Boolean) as string[]
    for (const p of paths) {
      try {
        await fs.unlink(p)
        console.log(`[AudioManager] Deleted temp WAV: ${p}`)
      } catch (err) {
        // Non-fatal: log and continue
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[AudioManager] Could not delete temp WAV "${p}": ${msg}`)
      }
    }
  }
}
