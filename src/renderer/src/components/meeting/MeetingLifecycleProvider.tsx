import { type FC, type ReactNode, useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { toast } from 'sonner'
import { useAppDispatch } from '@renderer/store/hooks'
import { updateNote } from '@renderer/store/slices/notesTreeSlice'
import { PcmTapStreamer } from '@renderer/lib/pcmTapStreamer'
import type { ProcessingProgress, RealtimeSegment, RealtimeStatusEvent } from '@preload/index.d'
import type { MeetingMetadata } from '@preload/types'
import {
  MeetingLifecycleContext,
  type LiveTranscriptionStatus,
  type MeetingLifecycleContextValue,
  type MeetingRecordingSession,
  type MeetingRecordingMode,
  type MeetingContentType,
  type MeetingSummaryDepth,
  type ProcessingJob,
  type ProcessingFailure,
  type RecordingStartFailure
} from '@renderer/hooks/useMeetingLifecycle'

export const MeetingLifecycleProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const dispatch = useAppDispatch()
  const pumpRunningRef = useRef(false)

  const [recordingSession, setRecordingSession] = useState<MeetingRecordingSession | null>(null)
  const [processingQueue, setProcessingQueue] = useState<ProcessingJob[]>([])
  const [activeProcessingJob, setActiveProcessingJob] = useState<ProcessingJob | null>(null)
  const [processingProgress, setProcessingProgress] = useState<ProcessingProgress | null>(null)
  const [processingFailure, setProcessingFailure] = useState<ProcessingFailure | null>(null)
  const [recordingStartFailure, setRecordingStartFailure] = useState<RecordingStartFailure | null>(
    null
  )
  const [liveSegments, setLiveSegments] = useState<RealtimeSegment[]>([])
  const [liveTranscriptionStatus, setLiveTranscriptionStatus] =
    useState<LiveTranscriptionStatus>('idle')

  const processingQueueRef = useRef<ProcessingJob[]>([])
  processingQueueRef.current = processingQueue

  const micRecorderRef = useRef<MediaRecorder | null>(null)
  const systemRecorderRef = useRef<MediaRecorder | null>(null)
  const micChunksRef = useRef<Blob[]>([])
  const systemChunksRef = useRef<Blob[]>([])
  const micStreamRef = useRef<MediaStream | null>(null)
  const systemStreamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const durationRef = useRef(0)
  const recordingModeRef = useRef<MeetingRecordingMode>('in-person')
  const recordingContentTypeRef = useRef<MeetingContentType>('meeting')
  const recordingSummaryDepthRef = useRef<MeetingSummaryDepth | undefined>(undefined)
  const recordingLanguageRef = useRef<string>('auto')
  const sessionIdsRef = useRef<{
    noteId: string
    spaceId: string
    folderId: string
  } | null>(null)
  const recordingStateRef = useRef<'idle' | 'recording' | 'paused'>('idle')
  const micTapRef = useRef<PcmTapStreamer | null>(null)
  const systemTapRef = useRef<PcmTapStreamer | null>(null)

  const stopAllStreams = useCallback((): void => {
    micStreamRef.current?.getTracks().forEach((t) => t.stop())
    systemStreamRef.current?.getTracks().forEach((t) => t.stop())
    micStreamRef.current = null
    systemStreamRef.current = null
  }, [])

  const stopTaps = useCallback(async (): Promise<void> => {
    const taps = [micTapRef.current, systemTapRef.current].filter(Boolean) as PcmTapStreamer[]
    micTapRef.current = null
    systemTapRef.current = null
    await Promise.allSettled(taps.map((tap) => tap.stop()))
  }, [])

  /**
   * Start the realtime transcription path for the active recording. Never
   * blocks or fails the recording itself — any error just downgrades the
   * status to 'unavailable' and the whisper post-processing path takes over.
   */
  const startLiveTranscription = useCallback(
    async (noteId: string, mode: MeetingRecordingMode, language: string): Promise<void> => {
      try {
        setLiveTranscriptionStatus('starting')
        const availability = await window.audio.startRealtime(noteId, {
          hasSystemTrack: mode === 'remote',
          language
        })
        if (!availability.available) {
          setLiveTranscriptionStatus('unavailable')
          return
        }

        // The user may have already stopped while the session was starting
        if (sessionIdsRef.current?.noteId !== noteId || recordingStateRef.current === 'idle') {
          console.warn('[MeetingLifecycle] Recording ended before realtime session came up')
          void window.audio.abortRealtime(noteId)
          return
        }

        if (micStreamRef.current) {
          const micTap = new PcmTapStreamer({ stream: micStreamRef.current, track: 'mic', noteId })
          try {
            await micTap.start()
          } catch (err) {
            throw new Error(`Mic PCM tap failed: ${err instanceof Error ? err.message : err}`)
          }
          micTapRef.current = micTap
        }
        if (systemStreamRef.current) {
          const systemTap = new PcmTapStreamer({
            stream: systemStreamRef.current,
            track: 'system',
            noteId
          })
          try {
            await systemTap.start()
          } catch (err) {
            throw new Error(`System PCM tap failed: ${err instanceof Error ? err.message : err}`)
          }
          systemTapRef.current = systemTap
        }

        // Recording may have been paused while the taps were being created
        if (recordingStateRef.current === 'paused') {
          micTapRef.current?.setGate(false)
          systemTapRef.current?.setGate(false)
        }
      } catch (err) {
        console.error('[MeetingLifecycle] Live transcription unavailable:', err)
        setLiveTranscriptionStatus('unavailable')
        void window.audio.abortRealtime(noteId)
        await stopTaps()
      }
    },
    [stopTaps]
  )

  const stopTimer = useCallback((): void => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const startTimer = useCallback((): void => {
    stopTimer()
    timerRef.current = setInterval(() => {
      durationRef.current += 1
      setRecordingSession((prev) => {
        if (!prev) return prev
        return { ...prev, duration: durationRef.current }
      })
    }, 1000)
  }, [stopTimer])

  const runProcessingPump = useCallback(async (): Promise<void> => {
    if (pumpRunningRef.current) return
    pumpRunningRef.current = true

    try {
      while (processingQueueRef.current.length > 0) {
        const job = processingQueueRef.current[0]
        setActiveProcessingJob(job)
        setProcessingProgress(null)

        try {
          const result = (await window.audio.processRecording(job.noteId, job.spaceId)) as {
            metadata: MeetingMetadata
            content: string
            summarizationError?: string
          }

          await dispatch(
            updateNote({
              spaceId: job.spaceId,
              folderId: job.folderId,
              noteId: job.noteId,
              updates: {
                content: result.content,
                meetingMetadata: result.metadata
              }
            })
          ).unwrap()

          setProcessingFailure((prev) => (prev?.noteId === job.noteId ? null : prev))
          // The transcript is always saved; a summarization error is surfaced as a
          // non-blocking warning (the note keeps the full transcript) rather than a
          // silent placeholder.
          if (result.summarizationError) {
            toast.warning(`Meeting saved, but the summary failed: ${result.summarizationError}`)
          } else {
            toast.success('Meeting processed')
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Processing failed'
          setProcessingFailure({ noteId: job.noteId, message })
          toast.error(message)
        }

        const next = processingQueueRef.current.slice(1)
        processingQueueRef.current = next
        setProcessingQueue(next)
        setProcessingProgress(null)
      }
      setActiveProcessingJob(null)
      setProcessingProgress(null)
    } finally {
      pumpRunningRef.current = false
      if (processingQueueRef.current.length > 0) {
        void runProcessingPump()
      }
    }
  }, [dispatch])

  const enqueueProcessingJob = useCallback(
    (job: ProcessingJob): void => {
      const next = [...processingQueueRef.current, job]
      processingQueueRef.current = next
      setProcessingQueue(next)
      void runProcessingPump()
    },
    [runProcessingPump]
  )

  useEffect(() => {
    return window.audio.onProcessingProgress((data: ProcessingProgress) => {
      setProcessingProgress(data)
    })
  }, [])

  useEffect(() => {
    return window.audio.onRealtimeSegment((segment: RealtimeSegment) => {
      if (sessionIdsRef.current?.noteId !== segment.noteId) return
      setLiveSegments((prev) =>
        // mic/system segments arrive interleaved — keep chronological order
        [...prev, segment].sort((a, b) => a.startTime - b.startTime)
      )
    })
  }, [])

  useEffect(() => {
    return window.audio.onRealtimeStatus((event: RealtimeStatusEvent) => {
      if (sessionIdsRef.current?.noteId !== event.noteId) return
      switch (event.status) {
        case 'starting':
          setLiveTranscriptionStatus('starting')
          break
        case 'live':
          setLiveTranscriptionStatus('live')
          break
        case 'failed':
          setLiveTranscriptionStatus('unavailable')
          break
        case 'stopped':
          setLiveTranscriptionStatus('idle')
          break
      }
    })
  }, [])

  const clearProcessingFailure = useCallback((): void => {
    setProcessingFailure(null)
  }, [])

  const clearRecordingStartFailure = useCallback((): void => {
    setRecordingStartFailure(null)
  }, [])

  const startRecording = useCallback(
    async (args: {
      noteId: string
      spaceId: string
      folderId: string
      mode: MeetingRecordingMode
      contentType?: MeetingContentType
      summaryDepth?: MeetingSummaryDepth
      language?: string
    }): Promise<void> => {
      const { noteId, spaceId, folderId, mode, contentType, summaryDepth, language } = args

      if (recordingStateRef.current !== 'idle') {
        toast.error('A recording is already in progress')
        return
      }

      setProcessingFailure((prev) => (prev?.noteId === noteId ? null : prev))
      setRecordingStartFailure((prev) => (prev?.noteId === noteId ? null : prev))

      sessionIdsRef.current = { noteId, spaceId, folderId }
      recordingStateRef.current = 'recording'
      durationRef.current = 0
      micChunksRef.current = []
      systemChunksRef.current = []
      recordingModeRef.current = mode
      recordingContentTypeRef.current = contentType ?? 'meeting'
      recordingSummaryDepthRef.current = summaryDepth
      recordingLanguageRef.current = language ?? 'auto'

      setRecordingSession({
        noteId,
        spaceId,
        folderId,
        state: 'recording',
        duration: 0
      })

      try {
        // Acquire system audio (getDisplayMedia) once, reused for both the
        // remote second track and the system-only primary track.
        const acquireSystemStream = async (): Promise<MediaStream> => {
          const displayStream = await navigator.mediaDevices.getDisplayMedia({ audio: true })
          displayStream.getVideoTracks().forEach((track) => track.stop())
          const audioTracks = displayStream.getAudioTracks()
          if (audioTracks.length === 0) {
            displayStream.getTracks().forEach((track) => track.stop())
            throw new Error(
              'System audio capture is not available. Ensure Screen Recording permission is granted in System Settings.'
            )
          }
          return new MediaStream(audioTracks)
        }

        // Primary track. Microphone for meeting modes; the captured system audio
        // for system-only (there is no mic). It always lives in the mic refs, so
        // the recorder / PCM tap ('mic') / saveRecording.micAudio path is uniform.
        const primaryStream =
          mode === 'system-only'
            ? await acquireSystemStream()
            : await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        micStreamRef.current = primaryStream

        const micRecorder = new MediaRecorder(primaryStream, { mimeType: 'audio/webm;codecs=opus' })
        micRecorder.ondataavailable = (e: BlobEvent): void => {
          if (e.data.size > 0) micChunksRef.current.push(e.data)
        }
        micRecorderRef.current = micRecorder

        // Remote also captures a second, separate system track alongside the mic.
        if (mode === 'remote') {
          const audioOnlyStream = await acquireSystemStream()
          systemStreamRef.current = audioOnlyStream

          const systemRecorder = new MediaRecorder(audioOnlyStream, {
            mimeType: 'audio/webm;codecs=opus'
          })
          systemRecorder.ondataavailable = (e: BlobEvent): void => {
            if (e.data.size > 0) systemChunksRef.current.push(e.data)
          }
          systemRecorderRef.current = systemRecorder
          systemRecorder.start()
        }

        micRecorder.start()
        startTimer()

        // Live transcription runs alongside the recorders; failures only
        // downgrade to the whisper post-processing path.
        setLiveSegments([])
        void startLiveTranscription(noteId, mode, language ?? 'auto')
      } catch (err) {
        stopAllStreams()
        void stopTaps()
        void window.audio.abortRealtime(noteId)
        setLiveTranscriptionStatus('idle')
        recordingStateRef.current = 'idle'
        sessionIdsRef.current = null
        const message = err instanceof Error ? err.message : 'Failed to start recording'
        setRecordingSession(null)
        setRecordingStartFailure({ noteId, message })
        toast.error(message)
      }
    },
    [startTimer, stopAllStreams, startLiveTranscription, stopTaps]
  )

  const pauseRecording = useCallback((): void => {
    if (recordingStateRef.current !== 'recording') return
    micRecorderRef.current?.pause()
    systemRecorderRef.current?.pause()
    // Gate the PCM taps so paused samples are dropped, keeping the live
    // transcript timeline aligned with the pause-compressed WAV.
    micTapRef.current?.setGate(false)
    systemTapRef.current?.setGate(false)
    stopTimer()
    recordingStateRef.current = 'paused'
    setRecordingSession((prev) => (prev ? { ...prev, state: 'paused' } : prev))
  }, [stopTimer])

  const resumeRecording = useCallback((): void => {
    if (recordingStateRef.current !== 'paused') return
    micRecorderRef.current?.resume()
    systemRecorderRef.current?.resume()
    micTapRef.current?.setGate(true)
    systemTapRef.current?.setGate(true)
    recordingStateRef.current = 'recording'
    startTimer()
    setRecordingSession((prev) => (prev ? { ...prev, state: 'recording' } : prev))
  }, [startTimer])

  const stopRecording = useCallback(async (): Promise<void> => {
    if (recordingStateRef.current === 'idle' || !sessionIdsRef.current) return

    const { noteId, spaceId, folderId } = sessionIdsRef.current
    const mode = recordingModeRef.current

    stopTimer()
    recordingStateRef.current = 'idle'

    // Stop the PCM taps before the recorders — no more chunks reach the VAD
    await stopTaps()

    // Wait for whichever recorders are active (mic/primary always; the second
    // system recorder only in remote mode) to flush their final chunks.
    const activeRecorders = [micRecorderRef.current, systemRecorderRef.current].filter(
      (r): r is MediaRecorder => !!r && r.state !== 'inactive'
    )
    await new Promise<void>((resolve) => {
      if (activeRecorders.length === 0) {
        resolve()
        return
      }
      let pendingStops = activeRecorders.length
      const handleStop = (): void => {
        pendingStops -= 1
        if (pendingStops === 0) resolve()
      }
      activeRecorders.forEach((recorder) => {
        recorder.onstop = handleStop
        recorder.stop()
      })
    })

    stopAllStreams()

    // Finish the live session BEFORE saveRecording: guarantees the realtime
    // transcript is stored in main before processRecording consumes it.
    // A failed/absent session returns hasTranscript:false → whisper fallback.
    try {
      await window.audio.stopRealtime(noteId)
    } catch (err) {
      console.warn('[MeetingLifecycle] stopRealtime failed — whisper fallback:', err)
    }
    setLiveTranscriptionStatus('idle')

    try {
      // Primary track (mic for meeting modes; system audio for system-only).
      const micBlob = new Blob(micChunksRef.current, { type: 'audio/webm' })
      const micBuffer = await micBlob.arrayBuffer()
      const micAudio = new Uint8Array(micBuffer)

      // Second system track exists only in remote mode.
      let systemAudio: Uint8Array | undefined
      if (mode === 'remote' && systemChunksRef.current.length > 0) {
        const systemBlob = new Blob(systemChunksRef.current, { type: 'audio/webm' })
        const systemBuffer = await systemBlob.arrayBuffer()
        systemAudio = new Uint8Array(systemBuffer)
      }

      await window.audio.saveRecording(noteId, spaceId, {
        micAudio,
        systemAudio,
        mode,
        contentType: recordingContentTypeRef.current,
        summaryDepth: recordingSummaryDepthRef.current,
        durationSecs: durationRef.current,
        language: recordingLanguageRef.current
      })

      micChunksRef.current = []
      systemChunksRef.current = []
      micRecorderRef.current = null
      systemRecorderRef.current = null
      sessionIdsRef.current = null
      setRecordingSession(null)

      enqueueProcessingJob({ noteId, spaceId, folderId })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save recording'
      toast.error(message)
      micChunksRef.current = []
      systemChunksRef.current = []
      micRecorderRef.current = null
      systemRecorderRef.current = null
      sessionIdsRef.current = null
      setRecordingSession(null)
      // The stored realtime transcript is orphaned when the save fails
      void window.audio.abortRealtime(noteId)
    }
  }, [stopTimer, stopAllStreams, stopTaps, enqueueProcessingJob])

  const isRecordingBusy = recordingSession !== null

  const value = useMemo<MeetingLifecycleContextValue>(
    () => ({
      recordingSession,
      isRecordingBusy,
      startRecording,
      pauseRecording,
      resumeRecording,
      stopRecording,
      processingQueue,
      activeProcessingJob,
      processingProgress,
      processingFailure,
      clearProcessingFailure,
      recordingStartFailure,
      clearRecordingStartFailure,
      liveSegments,
      liveTranscriptionStatus
    }),
    [
      recordingSession,
      isRecordingBusy,
      startRecording,
      pauseRecording,
      resumeRecording,
      stopRecording,
      processingQueue,
      activeProcessingJob,
      processingProgress,
      processingFailure,
      clearProcessingFailure,
      recordingStartFailure,
      clearRecordingStartFailure,
      liveSegments,
      liveTranscriptionStatus
    ]
  )

  return (
    <MeetingLifecycleContext.Provider value={value}>{children}</MeetingLifecycleContext.Provider>
  )
}
