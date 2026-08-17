/**
 * AudioManager - Singleton Orchestrator for Meeting Audio Pipeline
 *
 * Coordinates the full post-processing pipeline for meeting notes:
 *   1. (Conversion already done in audioHandlers before processRecording is called)
 *   2. Transcription via ProcessingUtilityManager (off main thread)
 *      - Single engine: WhisperService (whisper.cpp), GPU when available else CPU
 *   3. Diarization via ProcessingUtilityManager (off main thread, always CPU sherpa-onnx)
 *   4. Timeline merge + speaker label assignment (main thread, lightweight)
 *   5. Summarization via AIManager (main thread, GPU via node-llama-cpp)
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
import fs from 'node:fs/promises'
import { app } from 'electron'
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
  DiarizationSegment,
  WhisperVariant
} from './types'
import { ProcessingUtilityManager } from './ProcessingUtilityManager'
import type { WorkerInitConfig } from './processingWorker'
import type { RealtimeSessionResult } from './realtime/types'
import { HardwareDetector } from '../ai/HardwareDetector'
import { ModelRegistry } from '../ai/ModelRegistry'
import type { HardwareInfo } from '../ai/types'
import { normalizeLanguageCode, resolveMeetingLanguage } from './language'
import { isCrossTalkDuplicate } from './crossTalk'
import { SummaryService } from './summary/SummaryService'
import type { SummaryContentType, SummaryDepth, SummaryOutcome } from './summary/types'

/**
 * TEMPORARY DEBUG AID — when true, the raw (unprocessed) whisper transcription
 * is appended at the bottom of every generated meeting note so language
 * detection issues can be diagnosed. Flip to false (or remove the flag, the
 * buildDebugTranscriptSection method and its call site) once the language
 * pipeline is validated.
 */
const APPEND_RAW_TRANSCRIPT_DEBUG = false

// ---------------------------------------------------------------------------
// AudioManager
// ---------------------------------------------------------------------------

export class AudioManager {
  private static instance: AudioManager | null = null
  private initialized = false
  private workerManager: ProcessingUtilityManager | null = null
  /**
   * Whether the current worker was initialized with whisper requested.
   * The realtime path skips loading the whisper model (~1.5GB saved); a later
   * job that needs the fallback re-initializes the worker with the model.
   */
  private workerWhisperRequested = false

  /** Release the worker (and its ~1GB of models) after this idle period. */
  private static readonly IDLE_DISPOSE_MS = 5 * 60 * 1000
  private idleDisposeTimer: NodeJS.Timeout | null = null

  private constructor() {
    // §3.1 — singleton; use AudioManager.getInstance()
  }

  // §3.1 — singleton access
  static getInstance(): AudioManager {
    if (!AudioManager.instance) {
      AudioManager.instance = new AudioManager()
    }
    return AudioManager.instance
  }

  // §3.3 — idempotent initialization
  async initialize(options?: { needsWhisper?: boolean }): Promise<void> {
    const needsWhisper = options?.needsWhisper ?? true

    if (this.initialized) {
      // A worker started without whisper (realtime path) must be rebuilt when
      // a job that needs the whisper fallback arrives.
      if (!needsWhisper || this.workerWhisperRequested) return
      console.log('[AudioManager] Worker lacks whisper — re-initializing with the model')
      await this.dispose()
    }

    console.log(`[AudioManager] Initializing${needsWhisper ? '' : ' (whisper skipped)'}...`)

    const { configStore } = await import('../utils/configStore')
    const modelsBase = join(app.getPath('userData'), 'models')

    // ------------------------------------------------------------------
    // Detect hardware and choose the whisper.cpp backend:
    //   macOS      → Metal (default build)
    //   Win/Linux  → CUDA (NVIDIA) or Vulkan (AMD/Intel) when present, else CPU
    // ------------------------------------------------------------------
    const hardware = await HardwareDetector.detect()
    const { useGpu, variant: whisperVariant } = this.selectWhisperBackend(hardware)
    console.log(
      `[AudioManager] GPU: ${hardware.gpu.name} | Metal: ${hardware.gpu.hasMetal} | ` +
        `CUDA: ${hardware.gpu.hasCuda} | Vulkan: ${hardware.gpu.hasVulkan} → ` +
        `backend: ${useGpu ? whisperVariant : 'CPU'}`
    )

    // ------------------------------------------------------------------
    // Select the whisper.cpp (GGML) transcription model.
    // A single engine handles both GPU (Metal / CUDA / Vulkan) and CPU.
    // ------------------------------------------------------------------
    let whisperModelPath: string | undefined

    if (needsWhisper) {
      const meetingConfig = configStore.get('meeting')
      const ggmlModels = ModelRegistry.getGgmlTranscriptionModels()

      // Prefer the configured model when present on disk...
      const configured = ggmlModels.find((m) => m.id === meetingConfig.whisperModelId)
      if (configured) {
        const candidate = join(modelsBase, configured.filename)
        if (await this.pathExists(candidate)) {
          whisperModelPath = candidate
          console.log(`[AudioManager] Transcription model: ${configured.id}`)
        }
      }

      // ...otherwise fall back to the largest available GGML model on disk.
      if (!whisperModelPath) {
        for (const model of [...ggmlModels].sort((a, b) => b.sizeBytes - a.sizeBytes)) {
          const candidate = join(modelsBase, model.filename)
          if (await this.pathExists(candidate)) {
            whisperModelPath = candidate
            console.log(`[AudioManager] Transcription model (auto-selected): ${model.id}`)
            configStore.set('meeting', { ...meetingConfig, whisperModelId: model.id })
            break
          }
        }
      }

      if (!whisperModelPath) {
        console.warn('[AudioManager] No GGML whisper model found on disk — transcription disabled')
      }
    }

    // ------------------------------------------------------------------
    // Diarization model paths (always CPU, sherpa-onnx)
    // NeMo TitaNet Small (~2.7x faster) is the sole speaker-embedding model.
    // ------------------------------------------------------------------
    const segmentationModelPath = join(modelsBase, 'model.onnx')

    const embeddingModelPath = join(modelsBase, 'nemo_en_titanet_small.onnx')
    if (!(await this.pathExists(embeddingModelPath))) {
      console.warn(
        '[AudioManager] NeMo TitaNet embedding model not found on disk — diarization disabled'
      )
    }

    // ------------------------------------------------------------------
    // Start the processing worker
    // ------------------------------------------------------------------
    const workerConfig: WorkerInitConfig = {
      whisperModelPath,
      useGpu,
      whisperVariant,
      segmentationModelPath,
      embeddingModelPath
    }

    this.workerManager = new ProcessingUtilityManager()
    await this.workerManager.initialize(workerConfig)

    this.initialized = true
    this.workerWhisperRequested = needsWhisper
    console.log(
      `[AudioManager] Initialized — transcription: ${
        needsWhisper ? `whisper.cpp (${useGpu ? whisperVariant.toUpperCase() : 'CPU'})` : 'realtime'
      }, worker: ready`
    )
  }

  /**
   * Choose the whisper.cpp native backend for the detected hardware.
   * - macOS: Metal is compiled into the default build → 'default'
   * - Windows/Linux: prefer CUDA (NVIDIA), then Vulkan (AMD/Intel), else CPU
   */
  private selectWhisperBackend(hardware: HardwareInfo): {
    useGpu: boolean
    variant: WhisperVariant
  } {
    if (hardware.platform === 'darwin') {
      return { useGpu: hardware.gpu.hasMetal, variant: 'default' }
    }
    if (hardware.gpu.hasCuda) return { useGpu: true, variant: 'cuda' }
    if (hardware.gpu.hasVulkan) return { useGpu: true, variant: 'vulkan' }
    return { useGpu: false, variant: 'default' }
  }

  /** Returns true if the given path exists (file or directory). */
  private async pathExists(p: string): Promise<boolean> {
    try {
      await fs.access(p)
      return true
    } catch {
      return false
    }
  }

  // §3.4 — full cleanup
  async dispose(): Promise<void> {
    console.log('[AudioManager] Disposing...')
    this.clearIdleDispose()
    await this.workerManager?.dispose()
    this.workerManager = null
    this.initialized = false
    this.workerWhisperRequested = false
    console.log('[AudioManager] Disposed')
  }

  /** Cancel a pending idle-dispose (the manager is active again). */
  private clearIdleDispose(): void {
    if (this.idleDisposeTimer) {
      clearTimeout(this.idleDisposeTimer)
      this.idleDisposeTimer = null
    }
  }

  /**
   * Release the worker and its loaded models after a period of inactivity, so a
   * single meeting doesn't keep ~1GB resident forever on memory-constrained
   * machines. The next recording re-initializes lazily.
   */
  private scheduleIdleDispose(): void {
    this.clearIdleDispose()
    this.idleDisposeTimer = setTimeout(() => {
      console.log('[AudioManager] Idle timeout — releasing transcription/diarization models')
      void this.dispose()
    }, AudioManager.IDLE_DISPOSE_MS)
    // Do not keep the process alive just for this timer.
    this.idleDisposeTimer.unref?.()
  }

  /**
   * Run the full post-processing pipeline for a meeting recording.
   *
   * The WAV files must already exist on disk (conversion is done in audioHandlers
   * as part of audio:saveRecording before this method is called).
   *
   * @param noteId        Unique note identifier
   * @param spaceId       Space identifier (used for path construction / cleanup)
   * @param micWavPath    Absolute path to the 16 kHz mono WAV for the primary track
   *                      (mic for meeting modes; the captured system audio for system-only)
   * @param systemWavPath Absolute path to the 16 kHz mono WAV for the second system track (remote only)
   * @param mode          Recording mode ('remote' | 'in-person' | 'system-only')
   * @param recordingDate ISO 8601 timestamp of when the recording started
   * @param durationSecs  Duration of the recording in seconds
   * @param contentType   'meeting' or 'media' — drives the summary structure
   * @param summaryDepth  Per-recording summary length override (undefined → global config)
   * @param onProgress    Progress callback; called at each pipeline stage
   * @param precomputed   Transcripts produced live during recording (realtime
   *                      path) — when present, whisper transcription is skipped
   */
  async processRecording(
    noteId: string,
    spaceId: string,
    micWavPath: string,
    systemWavPath: string | undefined,
    mode: 'remote' | 'in-person' | 'system-only',
    recordingDate: string,
    durationSecs: number,
    requestedLanguage: string,
    contentType: SummaryContentType,
    summaryDepth: SummaryDepth | undefined,
    onProgress: (progress: ProcessingProgress) => void,
    precomputed?: RealtimeSessionResult,
    signal?: AbortSignal
  ): Promise<{ metadata: MeetingMetadata; content: string; summarizationError?: string }> {
    await this.initialize({ needsWhisper: !precomputed })
    this.clearIdleDispose()

    const { configStore } = await import('../utils/configStore')
    const pinnedLanguage = normalizeLanguageCode(requestedLanguage) // '' when auto

    console.log(
      `[AudioManager] processRecording — note=${noteId} space=${spaceId} mode=${mode} lang=${pinnedLanguage || 'auto'}`
    )

    // ------------------------------------------------------------------
    // Stage 1 + 2: Transcription and diarization run concurrently per track.
    // Diarization does not depend on the transcript, so overlapping them cuts
    // wall-clock time (ASR on GPU + diarization on CPU). The two transcriptions
    // are serialized inside the worker (a whisper context cannot run two jobs
    // at once) — the progress bar is split mic 0–50% / system 50–100%.
    // With a realtime (precomputed) transcript, only diarization runs here.
    // ------------------------------------------------------------------
    const hasSystemTrack = mode === 'remote' && !!systemWavPath

    const micDiarizationP = this.workerManager!.diarize(micWavPath)
    const systemDiarizationP: Promise<DiarizationResult | null> = hasSystemTrack
      ? this.workerManager!.diarize(systemWavPath!)
      : Promise.resolve(null)
    // The diarization promises are awaited only after transcription: attach
    // no-op handlers so an early rejection (e.g. worker crash) does not
    // surface as an unhandled rejection before the await below runs.
    micDiarizationP.catch(() => {})
    systemDiarizationP.catch(() => {})

    let micTranscription: TranscriptionResult
    let systemTranscription: TranscriptionResult | null

    if (precomputed) {
      console.log('[AudioManager] Stage: diarizing (transcript from realtime session)')
      micTranscription = precomputed.mic
      systemTranscription = hasSystemTrack ? (precomputed.system ?? null) : null
    } else {
      onProgress({ stage: 'transcribing', progress: 0, message: 'Transcribing audio...' })
      console.log('[AudioManager] Stage: transcribing + diarizing')

      const micTranscriptionP = this.workerManager!.transcribe(
        micWavPath,
        pinnedLanguage,
        (_stage, pct) =>
          onProgress({
            stage: 'transcribing',
            progress: hasSystemTrack ? Math.round(pct / 2) : pct,
            message: 'Transcribing audio...'
          })
      )

      const systemTranscriptionP: Promise<TranscriptionResult | null> = hasSystemTrack
        ? this.workerManager!.transcribe(systemWavPath!, pinnedLanguage, (_stage, pct) =>
            onProgress({
              stage: 'transcribing',
              progress: 50 + Math.round(pct / 2),
              message: 'Transcribing system audio...'
            })
          )
        : Promise.resolve(null)

      const [mic, system] = await Promise.all([micTranscriptionP, systemTranscriptionP])
      micTranscription = mic
      systemTranscription = system

      onProgress({ stage: 'transcribing', progress: 100, message: 'Transcription complete' })
    }

    onProgress({ stage: 'diarizing', progress: 0, message: 'Identifying speakers...' })

    // Diarization failures (including a native crash that kills the worker)
    // must not lose the meeting: degrade to a single-speaker timeline and let
    // transcript + summary proceed. The worker is disposed so the next job
    // re-initializes from a clean state.
    let micDiarization: DiarizationResult
    let systemDiarization: DiarizationResult | null
    try {
      ;[micDiarization, systemDiarization] = await Promise.all([
        micDiarizationP,
        systemDiarizationP
      ])
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(
        `[AudioManager] Diarization failed — falling back to single speaker: ${message}`
      )
      micDiarization = { segments: [{ speaker: 0, startTime: 0, endTime: 0 }], numSpeakers: 1 }
      systemDiarization = hasSystemTrack
        ? { segments: [{ speaker: 0, startTime: 0, endTime: 0 }], numSpeakers: 1 }
        : null
      await this.dispose()
    }

    onProgress({ stage: 'diarizing', progress: 100, message: 'Speaker identification complete' })

    // ------------------------------------------------------------------
    // Resolve the meeting language: explicit override → detected → user
    // default → app locale (never a blind 'en').
    // ------------------------------------------------------------------
    const detected =
      pinnedLanguage ||
      micTranscription.detectedLanguage ||
      systemTranscription?.detectedLanguage ||
      ''
    const userDefault = configStore.get('meeting').defaultLanguage
    const resolvedLanguage = resolveMeetingLanguage(detected, userDefault, app.getLocale())
    console.log(
      `[AudioManager] Language — pinned=${pinnedLanguage || '-'} detected=${detected || '-'} resolved=${resolvedLanguage}`
    )

    // ------------------------------------------------------------------
    // Stage 3: Merge timelines + assign speaker labels (main thread, lightweight)
    // ------------------------------------------------------------------
    const { speakers, transcriptionSegments } = this.buildTimeline(
      mode,
      micTranscription,
      micDiarization,
      systemTranscription,
      systemDiarization
    )

    // ------------------------------------------------------------------
    // Stage 4: Summarization (main thread, GPU via AIManager)
    // ------------------------------------------------------------------
    onProgress({ stage: 'summarizing', progress: 0, message: 'Generating summary...' })
    console.log('[AudioManager] Stage: summarizing')

    const summary = await this.summarizeTranscript(
      speakers,
      transcriptionSegments,
      resolvedLanguage,
      contentType,
      onProgress,
      signal,
      summaryDepth
    )
    const { content, actionItems, error: summarizationError } = summary

    onProgress({ stage: 'summarizing', progress: 100, message: 'Summary complete' })

    // ------------------------------------------------------------------
    // Build and return MeetingMetadata + content
    // (Cleanup is handled by audioHandlers based on config §4.2)
    // ------------------------------------------------------------------
    // Use the speakers/segments returned by summarization: clusters may have been
    // renamed from the transcript and merged, and the note refers to those names.
    const metadata: MeetingMetadata = {
      recordingMode: mode,
      contentType,
      duration: durationSecs,
      language: resolvedLanguage,
      recordingDate,
      speakers: summary.speakers,
      transcription: summary.transcription,
      actionItems
    }

    console.log('[AudioManager] processRecording complete')
    onProgress({ stage: 'done', progress: 100, message: 'Processing complete' })

    // Free the worker + models if no further recording arrives soon.
    this.scheduleIdleDispose()

    const finalContent = APPEND_RAW_TRANSCRIPT_DEBUG
      ? `${content}\n\n${this.buildDebugTranscriptSection(
          pinnedLanguage,
          resolvedLanguage,
          micTranscription,
          systemTranscription
        )}`
      : content

    return { metadata, content: finalContent, summarizationError }
  }

  /**
   * TEMPORARY DEBUG AID — markdown section with the raw whisper output per
   * track and the language resolution details, appended at the bottom of the
   * meeting note when APPEND_RAW_TRANSCRIPT_DEBUG is set. Note that
   * regenerateSummary rebuilds the note from segments only, so the section is
   * dropped on regeneration — acceptable for a temporary aid.
   */
  private buildDebugTranscriptSection(
    pinnedLanguage: string,
    resolvedLanguage: string,
    micTranscription: TranscriptionResult,
    systemTranscription: TranscriptionResult | null
  ): string {
    const lines: string[] = [
      '## Debug — Raw Transcript',
      '',
      '_Temporary debug output: unprocessed whisper transcription, before speaker/timeline merge._',
      '',
      `**Language** — pinned: ${pinnedLanguage || '-'} · mic detected: ${micTranscription.detectedLanguage || '-'} · ` +
        `system detected: ${systemTranscription ? systemTranscription.detectedLanguage || '-' : 'n/a'} · resolved: ${resolvedLanguage}`,
      '',
      '### Mic track (raw)',
      '',
      micTranscription.text.trim() || '_Empty._'
    ]
    if (systemTranscription) {
      lines.push('', '### System track (raw)', '', systemTranscription.text.trim() || '_Empty._')
    }
    return lines.join('\n')
  }

  /**
   * Re-run summarization on an already-transcribed meeting in a chosen language.
   * Used to correct a mis-detected language without re-recording — it only needs
   * the LLM (no transcription/diarization worker), so it stays lightweight.
   */
  async regenerateSummary(
    speakers: Speaker[],
    transcriptionSegments: TranscriptionSegment[],
    requestedLanguage: string,
    contentType: SummaryContentType = 'meeting',
    summaryDepth?: SummaryDepth
  ): Promise<{
    content: string
    actionItems: ActionItem[]
    language: string
    /** Speakers after name resolution — the caller must persist them. */
    speakers: Speaker[]
    /** Segments after cluster merging — the caller must persist them. */
    transcription: TranscriptionSegment[]
    summarizationError?: string
  }> {
    const { configStore } = await import('../utils/configStore')
    const resolvedLanguage = resolveMeetingLanguage(
      normalizeLanguageCode(requestedLanguage),
      configStore.get('meeting').defaultLanguage,
      app.getLocale()
    )
    console.log(
      `[AudioManager] Regenerating summary — language: ${resolvedLanguage}, type: ${contentType}`
    )

    const summary = await this.summarizeTranscript(
      speakers,
      transcriptionSegments,
      resolvedLanguage,
      contentType,
      () => {},
      undefined,
      summaryDepth
    )
    return {
      content: summary.content,
      actionItems: summary.actionItems,
      language: resolvedLanguage,
      speakers: summary.speakers,
      transcription: summary.transcription,
      summarizationError: summary.error
    }
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
    mode: 'remote' | 'in-person' | 'system-only',
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
      // in-person and system-only are both single-track: label speakers
      // generically as "Speaker N" (for system-only the single track holds the
      // captured system audio).
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

    // Build system segments first (higher quality — direct digital capture)
    const systemSegments: TranscriptionSegment[] = []
    if (systemTranscription && systemDiarization) {
      for (const seg of systemTranscription.segments) {
        const diarSeg = this.findDiarizationSegment(systemDiarization.segments, seg.startTime)
        const speakerId = sysSpeakerIdxToId.get(diarSeg?.speaker ?? 0) ?? 'speaker-sys-0'
        const duration = seg.endTime - seg.startTime
        const speaker = speakersMap.get(speakerId)
        if (speaker) speaker.totalSpeakingTime += duration
        systemSegments.push({
          speakerId,
          startTime: seg.startTime,
          endTime: seg.endTime,
          text: seg.text
        })
      }
    }

    // Assign mic transcription segments, deduplicating bleed-through from system
    // audio (speakers → microphone echo, mis-attributed to "You" otherwise).
    // Containment against the pooled overlapping system text handles the N:M
    // boundary mismatch between tracks — a single long mic VAD utterance can
    // correspond to several short system utterances (see crossTalk.ts).
    const segments: TranscriptionSegment[] = [...systemSegments]
    let droppedCount = 0

    for (const micSeg of micTranscription.segments) {
      if (isCrossTalkDuplicate(micSeg, systemSegments)) {
        droppedCount++
        continue
      }

      // Genuine mic-only speech — keep as "You"
      const diarSeg = this.findDiarizationSegment(micDiarization.segments, micSeg.startTime)
      const speakerId = micSpeakerIdxToId.get(diarSeg?.speaker ?? 0) ?? 'speaker-mic-0'
      const duration = micSeg.endTime - micSeg.startTime
      const speaker = speakersMap.get(speakerId)
      if (speaker) speaker.totalSpeakingTime += duration
      segments.push({
        speakerId,
        startTime: micSeg.startTime,
        endTime: micSeg.endTime,
        text: micSeg.text
      })
    }

    if (droppedCount > 0) {
      console.log(
        `[AudioManager] Deduplication: dropped ${droppedCount} mic segment(s) that were bleed-through from system audio`
      )
    }

    // Remove speakers with zero speaking time (phantom speakers from dropped segments)
    const activeSpeakers = Array.from(speakersMap.values()).filter((s) => s.totalSpeakingTime > 0)

    // Sort merged segments chronologically
    segments.sort((a, b) => a.startTime - b.startTime)

    return { speakers: activeSpeakers, transcriptionSegments: segments }
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

  // ---------------------------------------------------------------------------
  // Summarization (§6) — delegated to SummaryService
  // ---------------------------------------------------------------------------

  /**
   * Build the meeting/media note from the transcript.
   *
   * SummaryService owns the pipeline and also returns the speakers/segments it
   * resolved — cluster names deduced from the transcript, duplicate clusters
   * merged. Callers must persist those, otherwise the note shows real names
   * while the stored metadata still says "Speaker 7".
   */
  private async summarizeTranscript(
    speakers: Speaker[],
    transcriptionSegments: TranscriptionSegment[],
    language: string,
    contentType: SummaryContentType,
    onProgress: (progress: ProcessingProgress) => void,
    signal?: AbortSignal,
    summaryDepth?: SummaryDepth
  ): Promise<SummaryOutcome> {
    return SummaryService.getInstance().summarize({
      speakers,
      segments: transcriptionSegments,
      language,
      contentType,
      summaryDepth,
      onProgress,
      signal
    })
  }
}
