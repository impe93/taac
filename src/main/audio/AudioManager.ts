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
import { AIManager } from '../ai/AIManager'
import { HardwareDetector } from '../ai/HardwareDetector'
import { ModelRegistry } from '../ai/ModelRegistry'
import type { ChatMessage } from '../ai/AIManager'
import type { HardwareInfo } from '../ai/types'
import { getLanguageName, normalizeLanguageCode, resolveMeetingLanguage } from './language'

const DEFAULT_CHAT_MODEL_ID = 'qwen3-5-2b-q8'

/**
 * TEMPORARY DEBUG AID — when true, the raw (unprocessed) whisper transcription
 * is appended at the bottom of every generated meeting note so language
 * detection issues can be diagnosed. Flip to false (or remove the flag, the
 * buildDebugTranscriptSection method and its call site) once the language
 * pipeline is validated.
 */
const APPEND_RAW_TRANSCRIPT_DEBUG = true

// ---------------------------------------------------------------------------
// AudioManager
// ---------------------------------------------------------------------------

export class AudioManager {
  private static instance: AudioManager | null = null
  private initialized = false
  private workerManager: ProcessingUtilityManager | null = null

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
  async initialize(): Promise<void> {
    if (this.initialized) return

    console.log('[AudioManager] Initializing...')

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

    // ------------------------------------------------------------------
    // Diarization model paths (always CPU, sherpa-onnx)
    // Prefer NeMo TitaNet Small (~2.7x faster) if available, fall back to 3DSpeaker
    // ------------------------------------------------------------------
    const segmentationModelPath = join(modelsBase, 'model.onnx')

    const nemoEmbeddingPath = join(modelsBase, 'nemo_en_titanet_small.onnx')
    const threeDSpeakerEmbeddingPath = join(
      modelsBase,
      '3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx'
    )

    const nemoExists = await this.pathExists(nemoEmbeddingPath)
    const embeddingModelPath = nemoExists ? nemoEmbeddingPath : threeDSpeakerEmbeddingPath
    console.log(
      `[AudioManager] Diarization embedding: ${nemoExists ? 'NeMo TitaNet Small' : '3DSpeaker ERes2Net'}`
    )

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
    console.log(
      `[AudioManager] Initialized — transcription: whisper.cpp ` +
        `(${useGpu ? whisperVariant.toUpperCase() : 'CPU'}), worker: ready`
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
    requestedLanguage: string,
    onProgress: (progress: ProcessingProgress) => void
  ): Promise<{ metadata: MeetingMetadata; content: string; summarizationError?: string }> {
    await this.initialize()
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
    // ------------------------------------------------------------------
    onProgress({ stage: 'transcribing', progress: 0, message: 'Transcribing audio...' })
    console.log('[AudioManager] Stage: transcribing + diarizing')

    const hasSystemTrack = mode === 'remote' && !!systemWavPath

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
    const micDiarizationP = this.workerManager!.diarize(micWavPath)

    const systemTranscriptionP: Promise<TranscriptionResult | null> = hasSystemTrack
      ? this.workerManager!.transcribe(systemWavPath!, pinnedLanguage, (_stage, pct) =>
          onProgress({
            stage: 'transcribing',
            progress: 50 + Math.round(pct / 2),
            message: 'Transcribing system audio...'
          })
        )
      : Promise.resolve(null)
    const systemDiarizationP: Promise<DiarizationResult | null> = hasSystemTrack
      ? this.workerManager!.diarize(systemWavPath!)
      : Promise.resolve(null)

    const [micTranscription, systemTranscription] = await Promise.all([
      micTranscriptionP,
      systemTranscriptionP
    ])

    onProgress({ stage: 'transcribing', progress: 100, message: 'Transcription complete' })
    onProgress({ stage: 'diarizing', progress: 0, message: 'Identifying speakers...' })

    const [micDiarization, systemDiarization] = await Promise.all([
      micDiarizationP,
      systemDiarizationP
    ])

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
      onProgress
    )

    onProgress({ stage: 'summarizing', progress: 100, message: 'Summary complete' })

    // ------------------------------------------------------------------
    // Build and return MeetingMetadata + content
    // (Cleanup is handled by audioHandlers based on config §4.2)
    // ------------------------------------------------------------------
    const metadata: MeetingMetadata = {
      recordingMode: mode,
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
    requestedLanguage: string
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
    console.log(`[AudioManager] Regenerating summary — language: ${resolvedLanguage}`)

    const { content, actionItems, error } = await this.summarizeTranscript(
      speakers,
      transcriptionSegments,
      resolvedLanguage,
      () => {}
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

    // Assign mic transcription segments, deduplicating bleed-through from system audio.
    // For each mic segment, check if there's a temporally overlapping system segment
    // with similar text. If so, it's bleed-through (system audio picked up by mic) — skip it.
    const segments: TranscriptionSegment[] = [...systemSegments]
    const TIME_TOLERANCE_SECS = 2
    const SIMILARITY_THRESHOLD = 0.6
    let droppedCount = 0

    for (const micSeg of micTranscription.segments) {
      // Find system segments that overlap in time (within tolerance)
      const overlapping = systemSegments.filter(
        (sysSeg) =>
          micSeg.startTime <= sysSeg.endTime + TIME_TOLERANCE_SECS &&
          micSeg.endTime >= sysSeg.startTime - TIME_TOLERANCE_SECS
      )

      // Check if any overlapping system segment has similar text
      const isDuplicate = overlapping.some(
        (sysSeg) => this.computeTextSimilarity(micSeg.text, sysSeg.text) > SIMILARITY_THRESHOLD
      )

      if (isDuplicate) {
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
   * Compute Jaccard similarity between two text strings based on word sets.
   * Returns a value between 0 (completely different) and 1 (identical).
   */
  private computeTextSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean))
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean))
    if (wordsA.size === 0 && wordsB.size === 0) return 1
    if (wordsA.size === 0 || wordsB.size === 0) return 0
    let intersectionSize = 0
    for (const word of wordsA) {
      if (wordsB.has(word)) intersectionSize++
    }
    const unionSize = wordsA.size + wordsB.size - intersectionSize
    return unionSize === 0 ? 0 : intersectionSize / unionSize
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
    const loaded = AIManager.getInstance().getLoadedModels()
    const chatModel = loaded.find((m) =>
      ModelRegistry.getModel(m.id)?.capabilities.includes('chat')
    )
    return chatModel?.id ?? DEFAULT_CHAT_MODEL_ID
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
  private buildFallbackContent(transcriptText: string, reason: string): string {
    const transcriptBlock = transcriptText.trim() ? transcriptText.trim() : '_No speech detected._'
    return [
      '## Meeting Summary',
      '',
      `_${reason}_`,
      '',
      '## Key Topics Discussed',
      '',
      '_Not available._',
      '',
      '## Key Decisions',
      '',
      '_Not available._',
      '',
      '## Action Items',
      '',
      '_Not available._',
      '',
      '## Full Transcript',
      '',
      transcriptBlock
    ].join('\n')
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

  // Memory-friendly context for mid-end machines: map-reduce lets us use a small
  // KV cache instead of a single huge context, avoiding overflow on long meetings.
  private static readonly SUMMARY_CONTEXT_SIZE = 8192
  private static readonly SUMMARY_MAX_OUTPUT_TOKENS = 2048
  private static readonly MAP_MAX_OUTPUT_TOKENS = 1024
  private static readonly SUMMARY_SECTIONS = [
    '## Meeting Summary',
    '## Key Topics Discussed',
    '## Key Decisions',
    '## Action Items'
  ]

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
    onProgress: (progress: ProcessingProgress) => void
  ): Promise<{ content: string; actionItems: ActionItem[]; error?: string }> {
    const transcriptText = this.formatTranscriptForPrompt(transcriptionSegments, speakers)
    const languageName = getLanguageName(language)

    if (!transcriptText.trim()) {
      const reason = 'No speech was detected in this recording.'
      console.warn('[AudioManager] Empty transcript — skipping summarization')
      return {
        content: this.buildFallbackContent('', reason),
        actionItems: [],
        error: reason
      }
    }

    const aiManager = AIManager.getInstance()

    try {
      if (!aiManager.isInitialized()) {
        console.log('[AudioManager] AIManager not initialized — initializing now...')
        await aiManager.initialize()
      }

      const modelId = this.getActiveChatModelId()
      // Throws if the chat model is missing/unloadable → surfaced as a clear error.
      await aiManager.loadModel(modelId)
      console.log(`[AudioManager] Summarizing with model: ${modelId}`)

      let summary = await this.generateSummary(
        aiManager,
        modelId,
        transcriptText,
        languageName,
        onProgress,
        false
      )

      if (!this.isValidSummary(summary)) {
        console.warn('[AudioManager] Summary missing required sections — retrying once (strict)')
        const retry = await this.generateSummary(
          aiManager,
          modelId,
          transcriptText,
          languageName,
          onProgress,
          true
        )
        if (this.isValidSummary(retry)) {
          summary = retry
        } else {
          console.error('[AudioManager] Summary still incomplete after retry')
          return {
            content: this.buildFallbackContent(
              transcriptText,
              'The automatic summary was incomplete. The full transcript is preserved below.'
            ),
            actionItems: this.parseActionItems(summary),
            error: 'Summary was incomplete after retry.'
          }
        }
      }

      console.log(`[AudioManager] Summarization complete (${summary.length} chars)`)
      return { content: summary, actionItems: this.parseActionItems(summary) }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const stack = err instanceof Error ? err.stack : ''
      console.error(`[AudioManager] Summarization failed: ${msg}`)
      if (stack) console.error(`[AudioManager] Stack: ${stack}`)
      return {
        content: this.buildFallbackContent(
          transcriptText,
          `Automatic summarization failed: ${msg}. The full transcript is preserved below.`
        ),
        actionItems: [],
        error: msg
      }
    }
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
    onProgress: (progress: ProcessingProgress) => void,
    strict: boolean
  ): Promise<string> {
    const model = await aiManager.getModelInstance(modelId)
    const countTokens = (text: string): number => model.tokenize(text).length

    const finalSystemPrompt = this.buildSummarySystemPrompt(languageName, strict)
    const budget = Math.max(
      1024,
      AudioManager.SUMMARY_CONTEXT_SIZE -
        AudioManager.SUMMARY_MAX_OUTPUT_TOKENS -
        countTokens(finalSystemPrompt) -
        320 // framing / chat-template overhead margin
    )

    // Fits in one pass → summarize directly.
    if (countTokens(transcriptText) <= budget) {
      return this.runSummaryChat(
        aiManager,
        modelId,
        finalSystemPrompt,
        `Here is the meeting transcript:\n\n${transcriptText}`,
        AudioManager.SUMMARY_MAX_OUTPUT_TOKENS,
        (p) => onProgress({ stage: 'summarizing', progress: p, message: 'Generating summary...' }),
        10,
        95
      )
    }

    // ---- Map: summarize each chunk into intermediate notes ----
    const mapSystemPrompt = this.buildMapSystemPrompt(languageName)
    const chunks = this.splitIntoChunks(transcriptText, budget, countTokens)
    console.log(`[AudioManager] Long transcript — map-reduce over ${chunks.length} chunk(s)`)

    let partials: string[] = []
    for (let i = 0; i < chunks.length; i++) {
      const partial = await this.runSummaryChat(
        aiManager,
        modelId,
        mapSystemPrompt,
        `Meeting transcript part ${i + 1} of ${chunks.length}:\n\n${chunks[i]}`,
        AudioManager.MAP_MAX_OUTPUT_TOKENS
      )
      partials.push(partial)
      const pct = Math.round(((i + 1) / chunks.length) * 65)
      onProgress({ stage: 'summarizing', progress: pct, message: 'Summarizing sections...' })
    }

    // ---- Collapse partials until they fit the budget ----
    let guard = 0
    while (countTokens(partials.join('\n\n')) > budget && guard++ < 3) {
      const groups = this.groupByBudget(partials, budget, countTokens)
      const collapsed: string[] = []
      for (const group of groups) {
        collapsed.push(
          await this.runSummaryChat(
            aiManager,
            modelId,
            mapSystemPrompt,
            `Combine these meeting notes into one set of notes, preserving all decisions and action items:\n\n${group}`,
            AudioManager.MAP_MAX_OUTPUT_TOKENS
          )
        )
      }
      partials = collapsed
    }

    // ---- Reduce: synthesize the final structured summary ----
    const combined = partials.join('\n\n---\n\n')
    return this.runSummaryChat(
      aiManager,
      modelId,
      finalSystemPrompt,
      `Here are notes from consecutive parts of the same meeting, in order. Synthesize them into a single structured summary. Do not lose any decisions or action items:\n\n${combined}`,
      AudioManager.SUMMARY_MAX_OUTPUT_TOKENS,
      (p) => onProgress({ stage: 'summarizing', progress: p, message: 'Finalizing summary...' }),
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
    onProgress?: (percentage: number) => void,
    progressFrom = 0,
    progressTo = 100
  ): Promise<string> {
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ]

    const generator = aiManager.generateChatCompletion(modelId, messages, {
      isolated: true,
      maxTokens,
      contextSize: AudioManager.SUMMARY_CONTEXT_SIZE
    })

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

    // Strip any Full Transcript section the model might have added on its own.
    const transcriptHeadingIndex = fullContent.indexOf('## Full Transcript')
    if (transcriptHeadingIndex !== -1) {
      fullContent = fullContent.substring(0, transcriptHeadingIndex).trimEnd()
    }
    return fullContent.trim()
  }

  /** Whether the summary contains all required sections plus real body content. */
  private isValidSummary(text: string): boolean {
    if (!text) return false
    const hasAllSections = AudioManager.SUMMARY_SECTIONS.every((h) => text.includes(h))
    if (!hasAllSections) return false
    // Ensure there is meaningful content beyond the headings themselves.
    let body = text
    for (const h of AudioManager.SUMMARY_SECTIONS) body = body.split(h).join('')
    return body.replace(/[#\s_*\-[\]()]/g, '').length > 40
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
  private buildSummarySystemPrompt(languageName: string, strict: boolean): string {
    const strictLine = strict
      ? '\nYou MUST output every section below, each with real content. Do not skip any section.'
      : ''
    return `You are a meeting summarizer. Given a timestamped transcript with speaker labels, produce a structured and comprehensive summary in markdown format with the following sections:

## Meeting Summary
A comprehensive and detailed overview of the meeting. Write as many paragraphs as needed to thoroughly capture all important points, context, and nuances discussed. Do not limit yourself to a fixed number of sentences — cover everything that matters.

## Key Topics Discussed
Organized by topic. For each topic, provide thorough details including the context, what was discussed, different viewpoints expressed, who contributed, and any conclusions reached. Be comprehensive — do not omit relevant details.

## Key Decisions
Numbered list of decisions made during the meeting. For each decision, include the rationale and any conditions or caveats discussed.

## Action Items
Checklist format with assignee and deadline if mentioned:
- [ ] [Action description] — Assigned to: [Speaker] — Due: [Date if mentioned]

Be thorough and detailed in all sections. This summary will serve as a reference document and will be indexed for search, so completeness is more important than brevity.${strictLine}

IMPORTANT: Write ALL content (body text, bullet points, descriptions) in ${languageName}. The section headings (## Meeting Summary, ## Key Topics Discussed, ## Key Decisions, ## Action Items) MUST remain exactly as shown above in English for parsing consistency.
Do not include any text outside of these sections. Use the exact section headings above. Do NOT include a transcript section.`
  }

  /** System prompt for the map step (per-chunk intermediate notes). */
  private buildMapSystemPrompt(languageName: string): string {
    return `You are taking notes on part of a meeting transcript. Extract, in ${languageName}:
- the key points and context discussed
- any decisions made (with rationale)
- any action items (with assignee and deadline if mentioned)
- who said what when relevant

Be faithful and concise. Do not invent information. Output plain notes in ${languageName} — no preamble, no headings required. This is an intermediate note that will be merged with notes from other parts of the same meeting.`
  }
}
