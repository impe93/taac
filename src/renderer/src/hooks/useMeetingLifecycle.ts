import { createContext, useContext } from 'react'
import type { ProcessingProgress, RealtimeSegment } from '@preload/index.d'

export type MeetingRecordingMode = 'remote' | 'in-person' | 'system-only'

/** What is being recorded — drives the summary structure. */
export type MeetingContentType = 'meeting' | 'media'

/** Per-recording summary length override (internal enum; UI relabels it). */
export type MeetingSummaryDepth = 'conservative' | 'balanced' | 'aggressive'

export interface MeetingRecordingSession {
  noteId: string
  spaceId: string
  folderId: string
  state: 'recording' | 'paused'
  duration: number
}

export interface ProcessingJob {
  noteId: string
  spaceId: string
  folderId: string
}

export interface ProcessingFailure {
  noteId: string
  message: string
}

/** Failed to acquire streams / start MediaRecorder for this note (persists after session cleared) */
export interface RecordingStartFailure {
  noteId: string
  message: string
}

/**
 * Live transcription state for the active recording:
 * - 'idle'        no recording / no live session
 * - 'starting'    ASR sidecar warming up (utterances are queued, not lost)
 * - 'live'        segments arriving in real time
 * - 'unavailable' realtime path not available or failed — transcript will be
 *                 generated in post-processing (whisper fallback)
 */
export type LiveTranscriptionStatus = 'idle' | 'starting' | 'live' | 'unavailable'

export interface MeetingLifecycleContextValue {
  recordingSession: MeetingRecordingSession | null
  /** True while recording or paused (not idle) */
  isRecordingBusy: boolean
  startRecording: (args: {
    noteId: string
    spaceId: string
    folderId: string
    mode: MeetingRecordingMode
    /** Meeting (default) or listened media. Media requires system-only mode. */
    contentType?: MeetingContentType
    /** Per-recording summary length override; falls back to meeting.summaryDepth. */
    summaryDepth?: MeetingSummaryDepth
    /** Preferred spoken language: 'auto' (detect) or an ISO 639-1 code */
    language?: string
  }) => Promise<void>
  pauseRecording: () => void
  resumeRecording: () => void
  stopRecording: () => Promise<void>
  /** Jobs waiting + current (current is first in queue while pumping) */
  processingQueue: ProcessingJob[]
  /** Job currently running processRecording (head of queue) */
  activeProcessingJob: ProcessingJob | null
  processingProgress: ProcessingProgress | null
  /** Last pipeline failure for a specific note (survives dequeue / active job change) */
  processingFailure: ProcessingFailure | null
  clearProcessingFailure: () => void
  /** Last failed attempt to start recording (e.g. permission denied); not tied to active session */
  recordingStartFailure: RecordingStartFailure | null
  clearRecordingStartFailure: () => void
  /** Live transcript segments for the active recording, ordered by startTime */
  liveSegments: RealtimeSegment[]
  liveTranscriptionStatus: LiveTranscriptionStatus
}

export const MeetingLifecycleContext = createContext<MeetingLifecycleContextValue | null>(null)

export function useMeetingLifecycle(): MeetingLifecycleContextValue {
  const ctx = useContext(MeetingLifecycleContext)
  if (!ctx) {
    throw new Error('useMeetingLifecycle must be used within MeetingLifecycleProvider')
  }
  return ctx
}
