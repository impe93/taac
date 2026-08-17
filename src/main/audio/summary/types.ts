/**
 * Shared types for the meeting/media summarization pipeline.
 *
 * The pipeline is an inverted map-reduce: the map step produces the FINAL
 * "## Details" bullets directly (one per topic), and the reduce step only writes
 * the opening sections from an outline of those bullets. The document is then
 * assembled programmatically, so the per-topic detail budget grows with the
 * length of the meeting instead of competing with the other sections inside one
 * fixed output allowance.
 */

import type { ActionItem, Speaker, TranscriptionSegment } from '../../../preload/types'

export type SummaryDepth = 'conservative' | 'balanced' | 'aggressive'

/**
 * What was recorded. Drives the summary structure: a `meeting` produces the
 * summary/next-steps/details structure; `media` (e.g. an online course being
 * listened to) produces learning notes with no action items and no speakers.
 */
export type SummaryContentType = 'meeting' | 'media'

/**
 * Token budgets for one summarization run, selected per `meeting.summaryDepth`.
 *
 * Every stage must satisfy `input + output + systemPrompt + framing <= contextSize`.
 * The chunk size is deliberately an INDEPENDENT parameter rather than "whatever
 * is left in the context": filling a 4B model's context produces compressed,
 * topic-merging output — exactly what this pipeline exists to avoid.
 *
 * Caveat: the MLX backend (default on Apple Silicon) ignores `contextSize`
 * entirely — the sidecar only accepts max_tokens/temperature/top_p. There the
 * profiles affect chunking, quality and latency, but not memory.
 */
export interface SummaryBudget {
  /** Isolated LLM context size (input + output). Capped at the model's trainContextSize. */
  contextSize: number
  /** Max transcript tokens fed to a single map (details) call. */
  chunkInputTokens: number
  /** Max output tokens for each map (details) call. */
  mapOutputTokens: number
  /** Max outline + candidate-action tokens fed to the reduce call. */
  reduceInputTokens: number
  /** Max output tokens for the reduce call (opening sections only). */
  reduceOutputTokens: number
  /** Max evidence-sample tokens fed to the speaker resolution call. */
  speakerInputTokens: number
  /** Max output tokens for the speaker resolution call. */
  speakerOutputTokens: number
}

/**
 * Consecutive segments of one speaker merged into a single prompt line.
 *
 * Whisper emits a segment every few seconds; rendering one timestamped line per
 * segment costs ~14k tokens of pure timestamps on a 90-minute meeting and feeds
 * the model sentence fragments. Turns cut that overhead by ~75% and give the
 * model a readable dialogue.
 */
export interface Turn {
  speakerId: string
  label: string
  startTime: number
  endTime: number
  text: string
}

export interface TranscriptChunk {
  text: string
  startTime: number
  endTime: number
  /** Start time of every turn inside the chunk — used to snap model timestamps. */
  turnStarts: number[]
}

/** One "## Details" bullet: a topic title, its paragraph and its anchor time. */
export interface DetailBullet {
  title: string
  body: string
  startTime: number
}

/** A follow-up task spotted by the map step, before dedup/formatting. */
export interface CandidateAction {
  assignee?: string
  title: string
  description: string
}

/** One `<tag> | <name> | <evidence>` line returned by the speaker resolution step. */
export interface SpeakerNameMapping {
  /** The existing Speaker.label, used as the prompt-facing tag. */
  tag: string
  name: string
  evidence: string
}

export interface SpeakerResolutionResult {
  speakers: Speaker[]
  segments: TranscriptionSegment[]
  /** True when at least one cluster was renamed or merged. */
  changed: boolean
}

export interface SummaryOutcome {
  content: string
  actionItems: ActionItem[]
  /** Speakers after name resolution and cluster merging — persist these. */
  speakers: Speaker[]
  /** Segments after cluster merging (speakerIds remapped) — persist these. */
  transcription: TranscriptionSegment[]
  /** Non-blocking problem to surface to the user; the content is still usable. */
  error?: string
}

export type TokenCounter = (text: string) => number
