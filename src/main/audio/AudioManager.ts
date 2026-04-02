/**
 * AudioManager - Singleton Orchestrator for Meeting Audio Pipeline
 *
 * Coordinates the full post-processing pipeline for meeting notes:
 *   1. (Conversion already done in audioHandlers before processRecording is called)
 *   2. Transcription via ProcessingWorkerManager (off main thread)
 *      - GPU path: WhisperGpuService + GGML model (Metal / CUDA)
 *      - CPU path: TranscriptionService + ONNX model (sherpa-onnx)
 *   3. Diarization via ProcessingWorkerManager (off main thread, always CPU)
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
  DiarizationSegment
} from './types'
import { ProcessingUtilityManager } from './ProcessingUtilityManager'
import type { WorkerInitConfig } from './processingWorker'
import { AIManager } from '../ai/AIManager'
import { HardwareDetector } from '../ai/HardwareDetector'
import { ModelRegistry } from '../ai/ModelRegistry'
import type { ChatMessage } from '../ai/AIManager'

const DEFAULT_CHAT_MODEL_ID = 'qwen3-4b-instruct-2507-q8'

// ---------------------------------------------------------------------------
// AudioManager
// ---------------------------------------------------------------------------

export class AudioManager {
  private static instance: AudioManager | null = null
  private initialized = false
  private workerManager: ProcessingUtilityManager | null = null

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

    const { configStore } = await import('../utils/configStore')
    const modelsBase = join(app.getPath('userData'), 'models')

    // ------------------------------------------------------------------
    // Detect hardware GPU capabilities
    // ------------------------------------------------------------------
    const hardware = await HardwareDetector.detect()
    const hasGpu = hardware.gpu.hasMetal || hardware.gpu.hasCuda
    console.log(
      `[AudioManager] GPU: ${hardware.gpu.name} | Metal: ${hardware.gpu.hasMetal} | CUDA: ${hardware.gpu.hasCuda}`
    )

    // ------------------------------------------------------------------
    // Select transcription model based on GPU availability
    //
    // GPU path  → GGML model (whisper.cpp, Metal / CUDA)
    // CPU path  → ONNX model (sherpa-onnx)
    // ------------------------------------------------------------------
    let transcriptionMode: 'gpu' | 'cpu' = 'cpu'
    let whisperModelPath: string | undefined
    let whisperModelDir: string | undefined

    const meetingConfig = configStore.get('meeting')
    const configuredModelId = meetingConfig.whisperModelId

    if (hasGpu) {
      // Try to find a GGML model — prefer the one in config if it's GGML,
      // otherwise look for any downloaded GGML model
      const ggmlModels = ModelRegistry.getGgmlTranscriptionModels()

      // Check if the configured model is a GGML model that exists on disk
      const configuredGgml = ggmlModels.find((m) => m.id === configuredModelId)
      if (configuredGgml) {
        const candidatePath = join(modelsBase, configuredGgml.filename)
        const exists = await fs
          .access(candidatePath)
          .then(() => true)
          .catch(() => false)
        if (exists) {
          whisperModelPath = candidatePath
          transcriptionMode = 'gpu'
          console.log(`[AudioManager] GPU transcription — model: ${configuredGgml.id}`)
        }
      }

      // If configured GGML model not found, scan for any available GGML model
      if (!whisperModelPath) {
        for (const model of ggmlModels.sort((a, b) => b.sizeBytes - a.sizeBytes)) {
          const candidatePath = join(modelsBase, model.filename)
          const exists = await fs
            .access(candidatePath)
            .then(() => true)
            .catch(() => false)
          if (exists) {
            whisperModelPath = candidatePath
            transcriptionMode = 'gpu'
            console.log(`[AudioManager] GPU transcription — using available model: ${model.id}`)
            // Update config so future runs use this model
            configStore.set('meeting', { ...meetingConfig, whisperModelId: model.id })
            break
          }
        }
      }

      if (!whisperModelPath) {
        console.warn(
          '[AudioManager] GPU available but no GGML model found on disk — falling back to CPU'
        )
      }
    }

    // CPU fallback: find an ONNX model directory
    if (transcriptionMode === 'cpu' || !whisperModelPath) {
      transcriptionMode = 'cpu'
      let onnxModelId = configuredModelId
      let onnxModelDir = join(modelsBase, onnxModelId)

      const dirExists = await fs
        .access(onnxModelDir)
        .then(() => true)
        .catch(() => false)

      if (!dirExists) {
        console.warn(
          `[AudioManager] Configured ONNX model "${onnxModelId}" not found — searching for alternatives`
        )
        const onnxModels = ModelRegistry.getOnnxTranscriptionModels()
        let found = false
        for (const model of onnxModels) {
          const candidateDir = join(modelsBase, model.id)
          const exists = await fs
            .access(candidateDir)
            .then(() => true)
            .catch(() => false)
          if (exists) {
            onnxModelId = model.id
            onnxModelDir = candidateDir
            console.log(`[AudioManager] CPU transcription — using available model: ${model.id}`)
            configStore.set('meeting', { ...meetingConfig, whisperModelId: model.id })
            found = true
            break
          }
        }
        if (!found) {
          console.warn('[AudioManager] No transcription model found on disk')
        }
      } else {
        console.log(`[AudioManager] CPU transcription — model dir: ${onnxModelDir}`)
      }

      whisperModelDir = onnxModelDir
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

    const nemoExists = await fs
      .access(nemoEmbeddingPath)
      .then(() => true)
      .catch(() => false)
    const embeddingModelPath = nemoExists ? nemoEmbeddingPath : threeDSpeakerEmbeddingPath
    console.log(
      `[AudioManager] Diarization embedding: ${nemoExists ? 'NeMo TitaNet Small' : '3DSpeaker ERes2Net'}`
    )

    // ------------------------------------------------------------------
    // Start the processing worker
    // ------------------------------------------------------------------
    const workerConfig: WorkerInitConfig = {
      transcriptionMode,
      whisperModelPath,
      whisperModelDir,
      hasMetal: hardware.gpu.hasMetal,
      hasCuda: hardware.gpu.hasCuda,
      segmentationModelPath,
      embeddingModelPath
    }

    this.workerManager = new ProcessingUtilityManager()
    await this.workerManager.initialize(workerConfig)

    this.initialized = true
    console.log(
      `[AudioManager] Initialized — transcription: ${transcriptionMode.toUpperCase()}, worker: ready`
    )
  }

  // §3.4 — full cleanup
  async dispose(): Promise<void> {
    console.log('[AudioManager] Disposing...')
    await this.workerManager?.dispose()
    this.workerManager = null
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
  ): Promise<{ metadata: MeetingMetadata; content: string }> {
    await this.initialize()

    console.log(`[AudioManager] processRecording — note=${noteId} space=${spaceId} mode=${mode}`)

    // ------------------------------------------------------------------
    // Stage 1: Transcription (runs in worker thread — non-blocking)
    // ------------------------------------------------------------------
    onProgress({ stage: 'transcribing', progress: 0, message: 'Transcribing audio...' })
    console.log('[AudioManager] Stage: transcribing')

    const micTranscription = await this.workerManager!.transcribe(micWavPath)

    let systemTranscription: TranscriptionResult | null = null
    if (mode === 'remote' && systemWavPath) {
      onProgress({ stage: 'transcribing', progress: 50, message: 'Transcribing system audio...' })
      systemTranscription = await this.workerManager!.transcribe(systemWavPath)
    }

    onProgress({ stage: 'transcribing', progress: 100, message: 'Transcription complete' })

    // Detect language early so it's available for summarization
    const detectedLanguage =
      micTranscription.detectedLanguage || systemTranscription?.detectedLanguage || 'en'

    // ------------------------------------------------------------------
    // Stage 2: Diarization (runs in worker thread — non-blocking)
    // ------------------------------------------------------------------
    onProgress({ stage: 'diarizing', progress: 0, message: 'Identifying speakers...' })
    console.log('[AudioManager] Stage: diarizing')

    const micDiarization = await this.workerManager!.diarize(micWavPath)

    let systemDiarization: DiarizationResult | null = null
    if (mode === 'remote' && systemWavPath) {
      onProgress({ stage: 'diarizing', progress: 50, message: 'Identifying remote speakers...' })
      systemDiarization = await this.workerManager!.diarize(systemWavPath)
    }

    onProgress({ stage: 'diarizing', progress: 100, message: 'Speaker identification complete' })

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

    const { content, actionItems } = await this.summarizeTranscript(
      speakers,
      transcriptionSegments,
      detectedLanguage,
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
      language: detectedLanguage,
      recordingDate,
      speakers,
      transcription: transcriptionSegments,
      actionItems
    }

    console.log('[AudioManager] processRecording complete')
    onProgress({ stage: 'done', progress: 100, message: 'Processing complete' })

    return { metadata, content }
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
   * Convert ISO 639-1 language code to a human-readable language name.
   */
  private getLanguageName(code: string): string {
    const map: Record<string, string> = {
      en: 'English',
      it: 'Italian',
      es: 'Spanish',
      fr: 'French',
      de: 'German',
      pt: 'Portuguese',
      nl: 'Dutch',
      ru: 'Russian',
      zh: 'Chinese',
      ja: 'Japanese',
      ko: 'Korean',
      ar: 'Arabic',
      hi: 'Hindi',
      pl: 'Polish',
      sv: 'Swedish',
      da: 'Danish',
      fi: 'Finnish',
      no: 'Norwegian',
      tr: 'Turkish',
      cs: 'Czech',
      ro: 'Romanian',
      hu: 'Hungarian',
      uk: 'Ukrainian',
      el: 'Greek',
      he: 'Hebrew',
      th: 'Thai',
      vi: 'Vietnamese',
      id: 'Indonesian'
    }
    return map[code] ?? code
  }

  /**
   * Returns the ID of the first loaded chat model, or the default model ID.
   * This ensures we reuse a model already in memory without forcing a load.
   */
  private getActiveChatModelId(): string {
    const loaded = AIManager.getInstance().getLoadedModels()
    const chatModel = loaded.find((m) => m.id !== 'nomic-embed-text-v2-moe')
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
   * Build a fallback content string (raw transcript) used when summarization fails.
   */
  private buildFallbackContent(segments: TranscriptionSegment[], speakers: Speaker[]): string {
    const transcriptText = this.formatTranscriptForPrompt(segments, speakers)
    return `## Full Transcript\n\n<details>\n<summary>Click to expand full transcript</summary>\n\n${transcriptText}\n</details>\n`
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

  /**
   * Call AIManager to generate a structured meeting summary from the transcript.
   * Emits progress events during generation.
   * On failure, returns the raw transcript as content (graceful degradation).
   */
  private async summarizeTranscript(
    speakers: Speaker[],
    transcriptionSegments: TranscriptionSegment[],
    language: string,
    onProgress: (progress: ProcessingProgress) => void
  ): Promise<{ content: string; actionItems: ActionItem[] }> {
    const transcriptText = this.formatTranscriptForPrompt(transcriptionSegments, speakers)
    const languageName = this.getLanguageName(language)

    const systemPrompt = `You are a meeting summarizer. Given a timestamped transcript with speaker labels, produce a structured summary in markdown format with the following sections:

## Meeting Summary
A concise overview of the meeting (3-5 sentences).

## Key Topics Discussed
Organized by topic, with relevant details and who contributed.

## Key Decisions
Numbered list of decisions made during the meeting.

## Action Items
Checklist format with assignee and deadline if mentioned:
- [ ] [Action description] — Assigned to: [Speaker] — Due: [Date if mentioned]

## Full Transcript
<details>
<summary>Click to expand full transcript</summary>

[Timestamped transcript with speaker labels]
</details>

IMPORTANT: Write ALL content (body text, bullet points, descriptions) in ${languageName}. The section headings (## Meeting Summary, ## Key Topics Discussed, ## Key Decisions, ## Action Items, ## Full Transcript) MUST remain exactly as shown above in English for parsing consistency.
Do not include any text outside of these sections. Use the exact section headings above.`

    const userMessage = `Here is the meeting transcript:\n\n${transcriptText}`

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ]

    const aiManager = AIManager.getInstance()

    // Ensure AIManager is initialized (loads llama.cpp + GPU backend)
    if (!aiManager.isInitialized()) {
      console.log('[AudioManager] AIManager not initialized — initializing now...')
      await aiManager.initialize()
    }

    const modelId = this.getActiveChatModelId()
    console.log(`[AudioManager] Summarizing with model: ${modelId}`)

    // Ensure the chat model is loaded before generating
    await aiManager.loadModel(modelId)
    console.log(`[AudioManager] Model ${modelId} ready`)

    try {
      const generator = aiManager.generateChatCompletion(modelId, messages, {
        isolated: true,
        maxTokens: 4096,
        contextSize: 32768
      })

      let fullContent = ''
      let chunkCount = 0
      // We don't know total tokens; emit progress up to 90% based on chunk cadence
      const PROGRESS_INTERVAL = 20

      for await (const chunk of generator) {
        fullContent += chunk
        chunkCount++
        if (chunkCount % PROGRESS_INTERVAL === 0) {
          // Estimate progress: cap at 90% until we're done
          const estimated = Math.min(10 + chunkCount / 2, 90)
          onProgress({
            stage: 'summarizing',
            progress: Math.round(estimated),
            message: 'Generating summary...'
          })
        }
      }

      console.log(`[AudioManager] Summarization complete (${fullContent.length} chars)`)
      const actionItems = this.parseActionItems(fullContent)
      return { content: fullContent, actionItems }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const stack = err instanceof Error ? err.stack : ''
      console.error(`[AudioManager] Summarization failed, falling back to raw transcript: ${msg}`)
      if (stack) console.error(`[AudioManager] Stack: ${stack}`)
      return {
        content: this.buildFallbackContent(transcriptionSegments, speakers),
        actionItems: []
      }
    }
  }
}
