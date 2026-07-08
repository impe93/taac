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
import { randomUUID } from 'node:crypto'
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
import { AIManager } from '../ai/AIManager'
import { HardwareDetector } from '../ai/HardwareDetector'
import { ModelRegistry } from '../ai/ModelRegistry'
import type { ChatMessage } from '../ai/AIManager'
import type { HardwareInfo } from '../ai/types'
import { getLanguageName, normalizeLanguageCode, resolveMeetingLanguage } from './language'
import { isCrossTalkDuplicate } from './crossTalk'

/**
 * Token budget for a summarization pass. The context size and output-token
 * budget are the two levers that decide whether a long meeting summary fits
 * without being truncated. Chosen per `meeting.summaryDepth` so the user can
 * trade completeness against memory/speed on the mid-end (16GB) target.
 */
interface SummaryBudget {
  /** Isolated LLM context size (input + output). Capped at the model's trainContextSize. */
  contextSize: number
  /** Max output tokens for the final structured summary (reduce / single-pass). */
  finalOutputTokens: number
  /** Max output tokens for each intermediate map/collapse note. */
  mapOutputTokens: number
}

type SummaryDepth = 'conservative' | 'balanced' | 'aggressive'

/**
 * What was recorded. Drives the summary structure: a `meeting` produces the
 * classic decisions/action-items summary; `media` (e.g. an online course being
 * listened to) produces a learning-oriented notes structure.
 */
type SummaryContentType = 'meeting' | 'media'

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

  // Abort signal for the in-flight summarization. Set at the boundary of
  // summarizeTranscript and read by the private summary helpers so a cancelled
  // or aborted processing job stops the LLM generation instead of running it to
  // completion on the GPU. Processing jobs are serialized (one active abort
  // controller in audioHandlers), so a single field is safe.
  private summaryAbortSignal?: AbortSignal

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

    const {
      content,
      actionItems,
      error: summarizationError
    } = await this.summarizeTranscript(
      speakers,
      transcriptionSegments,
      resolvedLanguage,
      contentType,
      onProgress,
      signal,
      summaryDepth
    )

    onProgress({ stage: 'summarizing', progress: 100, message: 'Summary complete' })

    // ------------------------------------------------------------------
    // Build and return MeetingMetadata + content
    // (Cleanup is handled by audioHandlers based on config §4.2)
    // ------------------------------------------------------------------
    const metadata: MeetingMetadata = {
      recordingMode: mode,
      contentType,
      duration: durationSecs,
      language: resolvedLanguage,
      recordingDate,
      speakers,
      transcription: transcriptionSegments,
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

    const { content, actionItems, error } = await this.summarizeTranscript(
      speakers,
      transcriptionSegments,
      resolvedLanguage,
      contentType,
      () => {},
      undefined,
      summaryDepth
    )
    return { content, actionItems, language: resolvedLanguage, summarizationError: error }
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
  // Summarization helpers (§6)
  // ---------------------------------------------------------------------------

  /**
   * Returns the ID of the first loaded chat model, or the default model ID.
   * This ensures we reuse a model already in memory without forcing a load.
   */
  private getActiveChatModelId(): string {
    const aiManager = AIManager.getInstance()
    const loaded = aiManager.getLoadedModels()
    const chatModel = loaded.find((m) =>
      ModelRegistry.getModel(m.id)?.capabilities.includes('chat')
    )
    // Fall back to the hardware-resolved default (MLX on Apple Silicon, GGUF
    // elsewhere) rather than a hardcoded GGUF id.
    return chatModel?.id ?? aiManager.getDefaultChatModelId()
  }

  /**
   * Format [MM:SS - MM:SS] timestamp from seconds.
   */
  private formatTimestamp(secs: number): string {
    const m = Math.floor(secs / 60)
    const s = Math.floor(secs % 60)
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  /**
   * Convert transcript segments + speaker map into the prompt string:
   * [MM:SS - MM:SS] SpeakerLabel: text
   */
  private formatTranscriptForPrompt(segments: TranscriptionSegment[], speakers: Speaker[]): string {
    const speakerMap = new Map<string, string>(speakers.map((s) => [s.id, s.label]))
    return segments
      .map((seg) => {
        const label = speakerMap.get(seg.speakerId) ?? seg.speakerId
        const start = this.formatTimestamp(seg.startTime)
        const end = this.formatTimestamp(seg.endTime)
        return `[${start} - ${end}] ${label}: ${seg.text.trim()}`
      })
      .join('\n')
  }

  /**
   * Build fallback content used when summarization fails or is unavailable.
   * Preserves the raw transcript so the user never loses their meeting content,
   * and states the reason so the failure is visible rather than silent.
   */
  private buildFallbackContent(
    transcriptText: string,
    reason: string,
    contentType: SummaryContentType
  ): string {
    const transcriptBlock = transcriptText.trim() ? transcriptText.trim() : '_No speech detected._'
    const sections = AudioManager.SUMMARY_SECTIONS[contentType]
    const lines: string[] = []
    sections.forEach((heading, index) => {
      lines.push(heading, '', index === 0 ? `_${reason}_` : '_Not available._', '')
    })
    lines.push('## Full Transcript', '', transcriptBlock)
    return lines.join('\n')
  }

  /**
   * Parse action items from the LLM-generated markdown.
   * Matches lines like: - [ ] Description — Assigned to: Name — Due: Date
   */
  private parseActionItems(markdown: string): ActionItem[] {
    const actionItems: ActionItem[] = []
    // Match checklist lines under ## Action Items section
    const lines = markdown.split('\n')
    for (const line of lines) {
      const match = line.match(/^- \[ \] (.+)$/)
      if (!match) continue
      const raw = match[1]
      // Extract optional "— Assigned to: X" and "— Due: Y" parts
      const assigneeMatch = raw.match(/[—-]{1,2}\s*Assigned to:\s*([^—-]+)/i)
      const textMatch = raw.match(/^(.+?)(?:\s*[—-]|$)/)
      const text = textMatch ? textMatch[1].trim() : raw.trim()
      const assignee = assigneeMatch ? assigneeMatch[1].trim() : undefined
      actionItems.push({
        id: randomUUID(),
        text,
        assignee,
        completed: false
      })
    }
    return actionItems
  }

  // Budget profiles for summarization. A larger context + output budget lets long
  // meetings finish all sections without truncation; map-reduce still keeps every
  // single LLM call within the chosen context. The context is isolated (created
  // and disposed per call) and the ASR sidecar is already freed before summarizing,
  // so even the balanced profile stays within the 16GB target.
  private static readonly SUMMARY_PROFILES: Record<SummaryDepth, SummaryBudget> = {
    conservative: { contextSize: 12288, finalOutputTokens: 3072, mapOutputTokens: 1024 },
    balanced: { contextSize: 16384, finalOutputTokens: 4096, mapOutputTokens: 1536 },
    aggressive: { contextSize: 24576, finalOutputTokens: 4096, mapOutputTokens: 1536 }
  }
  private static readonly SUMMARY_SECTIONS: Record<SummaryContentType, string[]> = {
    meeting: [
      '## Meeting Summary',
      '## Key Topics Discussed',
      '## Key Decisions',
      '## Action Items'
    ],
    media: ['## Overview', '## Key Concepts', '## Important Points', '## Takeaways']
  }

  /**
   * Resolve the active summarization budget from the user's `meeting.summaryDepth`
   * preference. Falls back to the balanced profile if the config is missing or
   * unreadable, so summarization never breaks on a bad/legacy config value.
   */
  private async resolveSummaryBudget(override?: SummaryDepth): Promise<SummaryBudget> {
    if (override && AudioManager.SUMMARY_PROFILES[override]) {
      return AudioManager.SUMMARY_PROFILES[override]
    }
    try {
      const { configStore } = await import('../utils/configStore')
      const depth = configStore.get('meeting')?.summaryDepth as SummaryDepth | undefined
      return (
        (depth && AudioManager.SUMMARY_PROFILES[depth]) || AudioManager.SUMMARY_PROFILES.balanced
      )
    } catch {
      return AudioManager.SUMMARY_PROFILES.balanced
    }
  }

  /**
   * Generate a structured meeting summary from the transcript.
   *
   * Robustness (fixes the "sometimes no summary" bug):
   *   - map-reduce chunking within the model's token budget → no context overflow
   *   - required-section validation with one strict retry
   *   - failures surface to the caller (error field) instead of silently returning
   *     a placeholder; the raw transcript is always preserved in the content.
   *
   * The body language is `language`; section headings stay in English for parsing.
   */
  private async summarizeTranscript(
    speakers: Speaker[],
    transcriptionSegments: TranscriptionSegment[],
    language: string,
    contentType: SummaryContentType,
    onProgress: (progress: ProcessingProgress) => void,
    signal?: AbortSignal,
    summaryDepth?: SummaryDepth
  ): Promise<{ content: string; actionItems: ActionItem[]; error?: string }> {
    const transcriptText = this.formatTranscriptForPrompt(transcriptionSegments, speakers)
    const languageName = getLanguageName(language)

    if (!transcriptText.trim()) {
      const reason = 'No speech was detected in this recording.'
      console.warn('[AudioManager] Empty transcript — skipping summarization')
      return {
        content: this.buildFallbackContent('', reason, contentType),
        actionItems: [],
        error: reason
      }
    }

    const aiManager = AIManager.getInstance()
    this.summaryAbortSignal = signal
    let loadedModelId: string | undefined

    // Keep the summarizing progress bar monotonic: the strict retry re-runs
    // generateSummary from a low percentage, which would otherwise make the bar
    // jump backwards from ~95%. Clamp any emitted value to the highest seen.
    let progressCeiling = 0
    const monotonicProgress = (progress: ProcessingProgress): void => {
      if (progress.stage === 'summarizing' && typeof progress.progress === 'number') {
        if (progress.progress < progressCeiling) {
          onProgress({ ...progress, progress: progressCeiling })
          return
        }
        progressCeiling = progress.progress
      }
      onProgress(progress)
    }

    try {
      if (!aiManager.isInitialized()) {
        console.log('[AudioManager] AIManager not initialized — initializing now...')
        await aiManager.initialize()
      }

      const budget = await this.resolveSummaryBudget(summaryDepth)
      console.log(
        `[AudioManager] Summary budget — type ${contentType}, context ${budget.contextSize}, ` +
          `output ${budget.finalOutputTokens}/${budget.mapOutputTokens}`
      )

      const modelId = this.getActiveChatModelId()
      // Throws if the chat model is missing/unloadable → surfaced as a clear error.
      await aiManager.loadModel(modelId)
      loadedModelId = modelId
      console.log(`[AudioManager] Summarizing with model: ${modelId}`)

      const summary = await this.generateSummary(
        aiManager,
        modelId,
        transcriptText,
        languageName,
        contentType,
        monotonicProgress,
        budget,
        false
      )

      if (this.isValidSummary(summary, contentType)) {
        console.log(`[AudioManager] Summarization complete (${summary.length} chars)`)
        return { content: summary, actionItems: this.extractActionItems(summary, contentType) }
      }

      console.warn('[AudioManager] Summary missing required sections — retrying once (strict)')
      const retry = await this.generateSummary(
        aiManager,
        modelId,
        transcriptText,
        languageName,
        contentType,
        monotonicProgress,
        budget,
        true
      )

      if (this.isValidSummary(retry, contentType)) {
        console.log(`[AudioManager] Summarization complete on retry (${retry.length} chars)`)
        return { content: retry, actionItems: this.extractActionItems(retry, contentType) }
      }

      // Graceful degradation: rather than discarding a long, mostly-complete
      // summary and showing an empty "_Not available._" template, keep whatever
      // the model actually produced (the best of the two attempts). The
      // structured transcript is preserved independently in MeetingMetadata.
      const best = this.pickBestSummary(summary, retry, contentType)
      if (this.summaryBodyLength(best, contentType) > 40) {
        console.warn(
          '[AudioManager] Keeping incomplete summary (some sections missing) instead of discarding'
        )
        return {
          content: best,
          actionItems: this.extractActionItems(best, contentType),
          error: 'The automatic summary may be incomplete — some sections could be missing.'
        }
      }

      console.error('[AudioManager] Summary essentially empty after retry — using fallback')
      return {
        content: this.buildFallbackContent(
          transcriptText,
          'The automatic summary was incomplete. The full transcript is preserved below.',
          contentType
        ),
        actionItems: [],
        error: 'Summary was incomplete after retry.'
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const stack = err instanceof Error ? err.stack : ''
      console.error(`[AudioManager] Summarization failed: ${msg}`)
      if (stack) console.error(`[AudioManager] Stack: ${stack}`)
      return {
        content: this.buildFallbackContent(
          transcriptText,
          `Automatic summarization failed: ${msg}. The full transcript is preserved below.`,
          contentType
        ),
        actionItems: [],
        error: msg
      }
    } finally {
      this.summaryAbortSignal = undefined
      // Free the chat model right after the meeting (success OR failure) so
      // ~2.7GB of VRAM is not held until the 5-minute idle unload. It is
      // reloaded lazily on the next chat/summary use.
      if (loadedModelId) {
        try {
          await aiManager.unloadModel(loadedModelId)
          console.log(`[AudioManager] Unloaded chat model after summarization: ${loadedModelId}`)
        } catch (e) {
          console.error('[AudioManager] Failed to unload chat model after summarization:', e)
        }
      }
    }
  }

  /**
   * Build a synchronous token counter for the summary map-reduce, backend-aware:
   * - GGUF (node-llama-cpp): exact `model.tokenize().length`.
   * - MLX (Python sidecar): tokenizing every chunk over IPC would be slow, so we
   *   calibrate a chars-per-token ratio from ONE exact count of the full
   *   transcript and estimate from string length. The budgeting already carries
   *   safety margins, so an estimate is sufficient and avoids per-chunk IPC.
   */
  private async buildTokenCounter(
    aiManager: AIManager,
    modelId: string,
    calibrationText: string
  ): Promise<(text: string) => number> {
    if (ModelRegistry.getModel(modelId)?.format === 'mlx') {
      const total = await aiManager.countTokens(modelId, calibrationText)
      const charsPerToken = calibrationText.length / Math.max(1, total)
      return (text: string): number => Math.ceil(text.length / Math.max(charsPerToken, 1e-6))
    }
    const model = await aiManager.getModelInstance(modelId)
    return (text: string): number => model.tokenize(text).length
  }

  /**
   * Map-reduce summary generation that keeps every LLM call within the token
   * budget so it never overflows the context window.
   */
  private async generateSummary(
    aiManager: AIManager,
    modelId: string,
    transcriptText: string,
    languageName: string,
    contentType: SummaryContentType,
    onProgress: (progress: ProcessingProgress) => void,
    budget: SummaryBudget,
    strict: boolean
  ): Promise<string> {
    const countTokens = await this.buildTokenCounter(aiManager, modelId, transcriptText)

    const finalSystemPrompt = this.buildSummarySystemPrompt(languageName, strict, contentType)
    // Content-type-aware wording for the user turns (kept in English; the model
    // writes the body in `languageName`).
    const sourceLabel = contentType === 'media' ? 'recording' : 'meeting'
    const preserveClause =
      contentType === 'media'
        ? 'Do not lose any key concepts or important points'
        : 'Do not lose any decisions or action items'
    // Retry passes flag their progress messages so the frozen bar still tells the
    // user something is happening (the value itself is clamped monotonic upstream).
    const retryNote = strict ? ' (retry)' : ''
    // Token budget available for the prompt INPUT so that input + output + framing
    // stays within the isolated context and the summary is never truncated.
    const inputBudget = Math.max(
      1024,
      budget.contextSize - budget.finalOutputTokens - countTokens(finalSystemPrompt) - 320 // framing / chat-template overhead margin
    )

    // Fits in one pass → summarize directly.
    if (countTokens(transcriptText) <= inputBudget) {
      return this.runSummaryChat(
        aiManager,
        modelId,
        finalSystemPrompt,
        `Here is the ${sourceLabel} transcript:\n\n${transcriptText}`,
        budget.finalOutputTokens,
        budget.contextSize,
        (p) =>
          onProgress({
            stage: 'summarizing',
            progress: p,
            message: `Generating summary${retryNote}...`
          }),
        10,
        95
      )
    }

    // ---- Map: summarize each chunk into intermediate notes ----
    const mapSystemPrompt = this.buildMapSystemPrompt(languageName, contentType)
    const chunks = this.splitIntoChunks(transcriptText, inputBudget, countTokens)
    console.log(`[AudioManager] Long transcript — map-reduce over ${chunks.length} chunk(s)`)

    let partials: string[] = []
    for (let i = 0; i < chunks.length; i++) {
      const partial = await this.runSummaryChat(
        aiManager,
        modelId,
        mapSystemPrompt,
        `${sourceLabel === 'meeting' ? 'Meeting' : 'Recording'} transcript part ${i + 1} of ${chunks.length}:\n\n${chunks[i]}`,
        budget.mapOutputTokens,
        budget.contextSize
      )
      partials.push(partial)
      const pct = Math.round(((i + 1) / chunks.length) * 65)
      onProgress({
        stage: 'summarizing',
        progress: pct,
        message: `Summarizing sections${retryNote}...`
      })
    }

    // ---- Collapse partials until they fit the budget ----
    let guard = 0
    while (countTokens(partials.join('\n\n')) > inputBudget && guard++ < 5) {
      const groups = this.groupByBudget(partials, inputBudget, countTokens)
      const collapsed: string[] = []
      for (const group of groups) {
        collapsed.push(
          await this.runSummaryChat(
            aiManager,
            modelId,
            mapSystemPrompt,
            `Combine these ${sourceLabel} notes into one set of notes. ${preserveClause}:\n\n${group}`,
            budget.mapOutputTokens,
            budget.contextSize
          )
        )
      }
      partials = collapsed
    }

    // ---- Reduce: synthesize the final structured summary ----
    // Safety net: even if the collapse loop hit its guard, never feed the reduce
    // more than the context can hold — hard-truncate to the input budget so the
    // final call cannot overflow (which would fail the whole summary).
    let combined = partials.join('\n\n---\n\n')
    if (countTokens(combined) > inputBudget) {
      const perChar = countTokens(combined) / Math.max(1, combined.length)
      const maxChars = Math.floor(inputBudget / Math.max(perChar, 1e-6))
      console.warn(
        `[AudioManager] Reduce input still over budget after collapse — truncating to fit context`
      )
      combined = combined.slice(0, maxChars)
    }
    return this.runSummaryChat(
      aiManager,
      modelId,
      finalSystemPrompt,
      `Here are notes from consecutive parts of the same ${sourceLabel}, in order. Synthesize them into a single structured summary. ${preserveClause}:\n\n${combined}`,
      budget.finalOutputTokens,
      budget.contextSize,
      (p) =>
        onProgress({
          stage: 'summarizing',
          progress: p,
          message: `Finalizing summary${retryNote}...`
        }),
      70,
      95
    )
  }

  /**
   * Run a single isolated chat completion and return the cleaned text.
   * Optionally maps generation cadence to a progress range [progressFrom, progressTo].
   */
  private async runSummaryChat(
    aiManager: AIManager,
    modelId: string,
    systemPrompt: string,
    userMessage: string,
    maxTokens: number,
    contextSize: number,
    onProgress?: (percentage: number) => void,
    progressFrom = 0,
    progressTo = 100
  ): Promise<string> {
    // Don't start a new (map/collapse/reduce) generation once the job is aborted.
    if (this.summaryAbortSignal?.aborted) {
      throw new Error('Summarization aborted')
    }

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ]

    const generator = aiManager.generateChatCompletion(
      modelId,
      messages,
      {
        isolated: true,
        maxTokens,
        contextSize,
        // Disable reasoning for summaries: Qwen3.5's default thought budget (~75% of
        // context) can consume the entire maxTokens allowance before any structured
        // output is emitted, producing an empty summary. With thinking off the full
        // budget goes to the actual sections, and generation is deterministic/faster.
        thoughtTokens: 0,
        // Lower temperature for stable adherence to the required section format.
        temperature: 0.3
      },
      // Cancelling the processing job (or app shutdown) stops the native LLM
      // generation instead of running it to completion on the GPU.
      this.summaryAbortSignal
    )

    let fullContent = ''
    let chunkCount = 0
    for await (const chunk of generator) {
      fullContent += chunk
      chunkCount++
      if (onProgress && chunkCount % 20 === 0) {
        const span = progressTo - progressFrom
        const estimated = progressFrom + Math.min(span, chunkCount / 3)
        onProgress(Math.round(estimated))
      }
    }

    // Defensively strip any reasoning blocks a model might leak into the response.
    // `onTextChunk` already excludes thought segments, but this guards against
    // regressions (e.g. switching to onResponseChunk) and non-standard templates.
    fullContent = fullContent.replace(/<think>[\s\S]*?<\/think>/gi, '')

    // Strip any Full Transcript section the model might have added on its own.
    const transcriptHeadingIndex = fullContent.indexOf('## Full Transcript')
    if (transcriptHeadingIndex !== -1) {
      fullContent = fullContent.substring(0, transcriptHeadingIndex).trimEnd()
    }
    return fullContent.trim()
  }

  /** Whether the summary contains all required sections plus real body content. */
  private isValidSummary(text: string, contentType: SummaryContentType): boolean {
    if (!text) return false
    // Ignore any leaked reasoning block so it can't inflate the body-length check.
    const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '')
    const sections = AudioManager.SUMMARY_SECTIONS[contentType]
    const hasAllSections = sections.every((h) => cleaned.includes(h))
    if (!hasAllSections) return false
    // Ensure there is meaningful content beyond the headings themselves.
    return this.summaryBodyLength(cleaned, contentType) > 40
  }

  /**
   * Count real body characters (excluding required headings, markdown symbols and
   * any leaked reasoning). Used to tell an empty/near-empty summary from one that
   * has real content but is merely missing a section heading.
   */
  private summaryBodyLength(text: string, contentType: SummaryContentType): number {
    if (!text) return 0
    let body = text.replace(/<think>[\s\S]*?<\/think>/gi, '')
    for (const h of AudioManager.SUMMARY_SECTIONS[contentType]) body = body.split(h).join('')
    return body.replace(/[#\s_*\-[\]()]/g, '').length
  }

  /** Pick the attempt that produced the most real content (used for degradation). */
  private pickBestSummary(a: string, b: string, contentType: SummaryContentType): string {
    return this.summaryBodyLength(b, contentType) > this.summaryBodyLength(a, contentType) ? b : a
  }

  /**
   * Action items only exist for meetings. Media summaries have no
   * "## Action Items" section, so they never carry action items.
   */
  private extractActionItems(markdown: string, contentType: SummaryContentType): ActionItem[] {
    return contentType === 'meeting' ? this.parseActionItems(markdown) : []
  }

  /** Split transcript text into token-budgeted chunks at line boundaries. */
  private splitIntoChunks(
    text: string,
    budget: number,
    countTokens: (t: string) => number
  ): string[] {
    const lines = text.split('\n')
    // Estimate tokens-per-char once to avoid tokenizing every line.
    const perChar = countTokens(text) / Math.max(1, text.length)
    const chunks: string[] = []
    let current = ''
    let currentTokens = 0
    for (const line of lines) {
      const lineTokens = Math.ceil((line.length + 1) * perChar)
      if (currentTokens + lineTokens > budget && current) {
        chunks.push(current)
        current = ''
        currentTokens = 0
      }
      current += (current ? '\n' : '') + line
      currentTokens += lineTokens
    }
    if (current.trim()) chunks.push(current)
    return chunks.length > 0 ? chunks : [text]
  }

  /** Group partial summaries into budget-sized blobs for a reduction pass. */
  private groupByBudget(
    parts: string[],
    budget: number,
    countTokens: (t: string) => number
  ): string[] {
    const groups: string[] = []
    let current = ''
    for (const part of parts) {
      const candidate = current ? `${current}\n\n---\n\n${part}` : part
      if (current && countTokens(candidate) > budget) {
        groups.push(current)
        current = part
      } else {
        current = candidate
      }
    }
    if (current.trim()) groups.push(current)
    return groups
  }

  /** System prompt for the final structured summary. */
  private buildSummarySystemPrompt(
    languageName: string,
    strict: boolean,
    contentType: SummaryContentType
  ): string {
    if (contentType === 'media') {
      return this.buildMediaSummarySystemPrompt(languageName, strict)
    }
    const strictLine = strict
      ? '\nYou MUST output every one of the four sections below, each with real content. Do not skip any section.'
      : ''
    return `You are a meeting summarizer. Given a timestamped transcript with speaker labels, produce a structured summary in markdown format with EXACTLY these four sections, in this order:

## Meeting Summary
A detailed overview of the meeting capturing the important points, context, and nuances discussed.

## Key Topics Discussed
Organized by topic. For each topic, provide the context, what was discussed, different viewpoints expressed, who contributed, and any conclusions reached.

## Key Decisions
Numbered list of decisions made during the meeting, each with its rationale and any conditions or caveats. If no decisions were made, write "_None._".

## Action Items
Checklist format with assignee and deadline if mentioned:
- [ ] [Action description] — Assigned to: [Speaker] — Due: [Date if mentioned]
If no action items were mentioned, write "_None._" under this heading.

CRITICAL — budget your output so that ALL FOUR sections are always produced. Never spend so much detail on the earlier sections that you run out of room before "## Key Decisions" and "## Action Items". Keep each section proportionate; it is far better to be a little more concise everywhere than to omit a later section. The "## Action Items" heading must always be the final section and must always be present.${strictLine}

IMPORTANT: Write ALL content (body text, bullet points, descriptions) in ${languageName}. The section headings (## Meeting Summary, ## Key Topics Discussed, ## Key Decisions, ## Action Items) MUST remain exactly as shown above in English for parsing consistency.
Do not include any text outside of these sections. Use the exact section headings above. Do NOT include a transcript section.`
  }

  /**
   * System prompt for the final learning summary of listened media (e.g. an
   * online course). Same anti-overflow discipline as the meeting prompt, but a
   * learning-oriented structure instead of decisions/action items.
   */
  private buildMediaSummarySystemPrompt(languageName: string, strict: boolean): string {
    const strictLine = strict
      ? '\nYou MUST output every one of the four sections below, each with real content. Do not skip any section.'
      : ''
    return `You are summarizing media content (such as an online course, lecture, talk or video) that the user listened to. Given the transcript, produce structured learning notes in markdown format with EXACTLY these four sections, in this order:

## Overview
A concise overview of what the content covered, its purpose and the main thread of the argument or lesson.

## Key Concepts
The core concepts, definitions and ideas presented, each briefly explained so the notes stand on their own without the original media.

## Important Points
The most important points, arguments, examples, data or steps worth remembering. Use a bullet or numbered list.

## Takeaways
The practical takeaways, conclusions or things to remember/apply. If the content suggests exercises or next steps, list them here. If there are none, write "_None._".

CRITICAL — budget your output so that ALL FOUR sections are always produced. Never spend so much detail on the earlier sections that you run out of room before "## Important Points" and "## Takeaways". Keep each section proportionate; it is far better to be a little more concise everywhere than to omit a later section. The "## Takeaways" heading must always be the final section and must always be present.${strictLine}

IMPORTANT: Write ALL content (body text, bullet points, descriptions) in ${languageName}. The section headings (## Overview, ## Key Concepts, ## Important Points, ## Takeaways) MUST remain exactly as shown above in English for parsing consistency.
Do not include any text outside of these sections. Use the exact section headings above. Do NOT include a transcript section.`
  }

  /** System prompt for the map step (per-chunk intermediate notes). */
  private buildMapSystemPrompt(languageName: string, contentType: SummaryContentType): string {
    if (contentType === 'media') {
      return `You are taking notes on part of a media transcript (e.g. an online course or lecture). Extract, in ${languageName}:
- the key concepts and ideas presented
- important points, arguments, examples or steps
- any practical takeaways or conclusions

Be faithful and concise. Do not invent information. Output plain notes in ${languageName} — no preamble, no headings required. This is an intermediate note that will be merged with notes from other parts of the same recording.`
    }
    return `You are taking notes on part of a meeting transcript. Extract, in ${languageName}:
- the key points and context discussed
- any decisions made (with rationale)
- any action items (with assignee and deadline if mentioned)
- who said what when relevant

Be faithful and concise. Do not invent information. Output plain notes in ${languageName} — no preamble, no headings required. This is an intermediate note that will be merged with notes from other parts of the same meeting.`
  }
}
