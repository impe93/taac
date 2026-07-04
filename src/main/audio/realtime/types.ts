/**
 * Realtime Transcription Types
 *
 * Shared types for the live transcription path (VAD segmentation + Qwen3-ASR
 * MLX sidecar). Timestamps live on the pause-compressed recording timeline —
 * paused samples are never fed to the VAD, so segment times line up with the
 * WAV files used by diarization in post-processing.
 */

import type { TranscriptionResult } from '../types'

/** Audio source track. In remote mode both are recorded; in-person is mic only. */
export type RealtimeTrack = 'mic' | 'system'

/** One live-transcribed utterance, broadcast to the renderer as it completes */
export interface RealtimeSegment {
  noteId: string
  track: RealtimeTrack
  /** Seconds from recording start (pause-compressed, matches the WAV timeline) */
  startTime: number
  endTime: number
  text: string
  /** Normalized ISO 639-1 code detected for this utterance, '' when unknown */
  language: string
}

/** Session status broadcast to the renderer */
export type RealtimeStatus = 'starting' | 'live' | 'failed' | 'stopped'

export interface RealtimeStatusEvent {
  noteId: string
  status: RealtimeStatus
  message?: string
}

/**
 * Per-track transcripts synthesized when a realtime session finishes.
 * Shape-compatible with the whisper post-processing output so
 * AudioManager.processRecording can consume either source unchanged.
 */
export interface RealtimeSessionResult {
  mic: TranscriptionResult
  system?: TranscriptionResult
}
