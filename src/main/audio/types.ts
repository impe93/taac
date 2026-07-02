/**
 * Audio Module Types
 *
 * Type definitions for the meeting audio processing pipeline:
 * recording, conversion, transcription, and diarization.
 */

/** Stages of the post-processing pipeline, reported via progress events */
export type ProcessingStage =
  | 'idle'
  | 'converting'
  | 'transcribing'
  | 'diarizing'
  | 'summarizing'
  | 'done'
  | 'error'

/** Progress event emitted during pipeline execution */
export interface ProcessingProgress {
  stage: ProcessingStage
  /** 0–100 percentage within the current stage */
  progress: number
  message?: string
}

/**
 * whisper.cpp native backend variant (@fugood/whisper.node).
 * - 'default' → CPU everywhere, plus Metal on macOS Apple Silicon (compiled in)
 * - 'cuda'    → NVIDIA GPU acceleration on Windows / Linux
 * - 'vulkan'  → AMD / Intel GPU acceleration on Windows / Linux
 */
export type WhisperVariant = 'default' | 'cuda' | 'vulkan'

/** Result of a single transcription pass on a WAV file */
export interface TranscriptionResult {
  /** Full concatenated text */
  text: string
  /** Word/sentence-level segments with timestamps (seconds) */
  segments: TranscriptionSegment[]
  /** ISO 639-1 code detected by the model */
  detectedLanguage: string
}

/** One transcribed segment with timing */
export interface TranscriptionSegment {
  startTime: number
  endTime: number
  text: string
}

/** One speaker-labelled time interval from diarization */
export interface DiarizationSegment {
  /** 0-based speaker index assigned by the diarization model */
  speaker: number
  startTime: number
  endTime: number
}

/** Full diarization result */
export interface DiarizationResult {
  segments: DiarizationSegment[]
  /** Total number of unique speakers detected */
  numSpeakers: number
}

/** Paths to the saved audio files for a single recording session */
export interface AudioFilePaths {
  /** Path to the raw microphone WebM file */
  micWebm: string
  /** Path to the raw system-audio WebM file (remote mode only) */
  systemWebm?: string
  /** Path to the converted 16 kHz mono WAV for the mic track */
  micWav?: string
  /** Path to the converted 16 kHz mono WAV for the system track */
  systemWav?: string
}
