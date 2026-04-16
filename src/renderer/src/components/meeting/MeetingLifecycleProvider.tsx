import { type FC, type ReactNode, useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { toast } from 'sonner'
import { useAppDispatch } from '@renderer/store/hooks'
import { updateNote } from '@renderer/store/slices/notesTreeSlice'
import type { ProcessingProgress } from '@preload/index.d'
import type { MeetingMetadata } from '@preload/types'
import {
  MeetingLifecycleContext,
  type MeetingLifecycleContextValue,
  type MeetingRecordingSession,
  type MeetingRecordingMode,
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
  const sessionIdsRef = useRef<{
    noteId: string
    spaceId: string
    folderId: string
  } | null>(null)
  const recordingStateRef = useRef<'idle' | 'recording' | 'paused'>('idle')

  const stopAllStreams = useCallback((): void => {
    micStreamRef.current?.getTracks().forEach((t) => t.stop())
    systemStreamRef.current?.getTracks().forEach((t) => t.stop())
    micStreamRef.current = null
    systemStreamRef.current = null
  }, [])

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
          toast.success('Meeting processed')
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
    }): Promise<void> => {
      const { noteId, spaceId, folderId, mode } = args

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

      setRecordingSession({
        noteId,
        spaceId,
        folderId,
        state: 'recording',
        duration: 0
      })

      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        micStreamRef.current = micStream

        const micRecorder = new MediaRecorder(micStream, { mimeType: 'audio/webm;codecs=opus' })
        micRecorder.ondataavailable = (e: BlobEvent): void => {
          if (e.data.size > 0) micChunksRef.current.push(e.data)
        }
        micRecorderRef.current = micRecorder

        if (mode === 'remote') {
          const displayStream = await navigator.mediaDevices.getDisplayMedia({ audio: true })
          displayStream.getVideoTracks().forEach((track) => track.stop())

          const audioTracks = displayStream.getAudioTracks()
          if (audioTracks.length === 0) {
            displayStream.getTracks().forEach((track) => track.stop())
            throw new Error(
              'System audio capture is not available. Ensure Screen Recording permission is granted in System Settings.'
            )
          }

          const audioOnlyStream = new MediaStream(audioTracks)
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
      } catch (err) {
        stopAllStreams()
        recordingStateRef.current = 'idle'
        sessionIdsRef.current = null
        const message = err instanceof Error ? err.message : 'Failed to start recording'
        setRecordingSession(null)
        setRecordingStartFailure({ noteId, message })
        toast.error(message)
      }
    },
    [startTimer, stopAllStreams]
  )

  const pauseRecording = useCallback((): void => {
    if (recordingStateRef.current !== 'recording') return
    micRecorderRef.current?.pause()
    systemRecorderRef.current?.pause()
    stopTimer()
    recordingStateRef.current = 'paused'
    setRecordingSession((prev) => (prev ? { ...prev, state: 'paused' } : prev))
  }, [stopTimer])

  const resumeRecording = useCallback((): void => {
    if (recordingStateRef.current !== 'paused') return
    micRecorderRef.current?.resume()
    systemRecorderRef.current?.resume()
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

    await new Promise<void>((resolve) => {
      let pendingStops = 1 + (mode === 'remote' ? 1 : 0)
      const handleStop = (): void => {
        pendingStops -= 1
        if (pendingStops === 0) resolve()
      }

      if (micRecorderRef.current && micRecorderRef.current.state !== 'inactive') {
        micRecorderRef.current.onstop = handleStop
        micRecorderRef.current.stop()
      } else {
        handleStop()
      }

      if (
        mode === 'remote' &&
        systemRecorderRef.current &&
        systemRecorderRef.current.state !== 'inactive'
      ) {
        systemRecorderRef.current.onstop = handleStop
        systemRecorderRef.current.stop()
      } else if (mode === 'remote') {
        handleStop()
      }
    })

    stopAllStreams()

    try {
      const micBlob = new Blob(micChunksRef.current, { type: 'audio/webm' })
      const micBuffer = await micBlob.arrayBuffer()
      const micAudio = new Uint8Array(micBuffer)

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
        durationSecs: durationRef.current
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
    }
  }, [stopTimer, stopAllStreams, enqueueProcessingJob])

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
      clearRecordingStartFailure
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
      clearRecordingStartFailure
    ]
  )

  return (
    <MeetingLifecycleContext.Provider value={value}>{children}</MeetingLifecycleContext.Provider>
  )
}
