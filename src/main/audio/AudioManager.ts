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
import { TranscriptionService } from './TranscriptionService'
import { DiarizationService } from './DiarizationService'
import { AIManager } from '../ai/AIManager'
import type { ChatMessage } from '../ai/AIManager'

const DEFAULT_CHAT_MODEL_ID = 'qwen3-4b-instruct-2507-q8'

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
  ): Promise<{ metadata: MeetingMetadata; content: string }> {
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
    // Stage 4: Summarization
    // ------------------------------------------------------------------
    onProgress({ stage: 'summarizing', progress: 0, message: 'Generating summary...' })
    console.log('[AudioManager] Stage: summarizing')

    const { content, actionItems } = await this.summarizeTranscript(
      speakers,
      transcriptionSegments,
      onProgress
    )

    onProgress({ stage: 'summarizing', progress: 100, message: 'Summary complete' })

    // ------------------------------------------------------------------
    // Build and return MeetingMetadata + content
    // (Cleanup is handled by audioHandlers based on config §4.2)
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

  // ---------------------------------------------------------------------------
  // Summarization helpers (§6)
  // ---------------------------------------------------------------------------

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
    onProgress: (progress: ProcessingProgress) => void
  ): Promise<{ content: string; actionItems: ActionItem[] }> {
    const transcriptText = this.formatTranscriptForPrompt(transcriptionSegments, speakers)

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

Do not include any text outside of these sections. Use the exact section headings above.`

    const userMessage = `Here is the meeting transcript:\n\n${transcriptText}`

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ]

    const modelId = this.getActiveChatModelId()
    console.log(`[AudioManager] Summarizing with model: ${modelId}`)

    try {
      const aiManager = AIManager.getInstance()
      const generator = aiManager.generateChatCompletion(modelId, messages, {
        isolated: true,
        maxTokens: 4096
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
      console.error(`[AudioManager] Summarization failed, falling back to raw transcript: ${msg}`)
      return {
        content: this.buildFallbackContent(transcriptionSegments, speakers),
        actionItems: []
      }
    }
  }
}
