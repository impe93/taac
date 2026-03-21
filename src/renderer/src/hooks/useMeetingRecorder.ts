import { useState, useRef, useEffect, useCallback } from 'react'

type RecordingState = 'idle' | 'recording' | 'paused'

type RecordingMode = 'remote' | 'in-person'

interface UseMeetingRecorderReturn {
  state: RecordingState
  startRecording: (mode: RecordingMode) => Promise<void>
  pauseRecording: () => void
  resumeRecording: () => void
  stopRecording: (spaceId: string) => Promise<void>
  duration: number
  error: string | null
}

export function useMeetingRecorder(noteId: string): UseMeetingRecorderReturn {
  const [state, setState] = useState<RecordingState>('idle')
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const micRecorderRef = useRef<MediaRecorder | null>(null)
  const systemRecorderRef = useRef<MediaRecorder | null>(null)
  const micChunksRef = useRef<Blob[]>([])
  const systemChunksRef = useRef<Blob[]>([])
  const micStreamRef = useRef<MediaStream | null>(null)
  const systemStreamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const durationRef = useRef(0)
  const recordingModeRef = useRef<RecordingMode>('in-person')

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
      setDuration(durationRef.current)
    }, 1000)
  }, [stopTimer])

  // Cleanup on unmount
  useEffect(() => {
    return (): void => {
      stopTimer()
      if (micRecorderRef.current?.state !== 'inactive') {
        micRecorderRef.current?.stop()
      }
      if (systemRecorderRef.current?.state !== 'inactive') {
        systemRecorderRef.current?.stop()
      }
      stopAllStreams()
    }
  }, [stopAllStreams, stopTimer])

  const startRecording = useCallback(
    async (mode: RecordingMode): Promise<void> => {
      setError(null)
      durationRef.current = 0
      setDuration(0)
      micChunksRef.current = []
      systemChunksRef.current = []
      recordingModeRef.current = mode

      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        micStreamRef.current = micStream

        const micRecorder = new MediaRecorder(micStream, { mimeType: 'audio/webm;codecs=opus' })
        micRecorder.ondataavailable = (e: BlobEvent): void => {
          if (e.data.size > 0) micChunksRef.current.push(e.data)
        }
        micRecorderRef.current = micRecorder

        if (mode === 'remote') {
          const systemStream = await navigator.mediaDevices.getDisplayMedia({ audio: true })
          systemStreamRef.current = systemStream

          const systemRecorder = new MediaRecorder(systemStream, {
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
        setState('recording')
      } catch (err) {
        stopAllStreams()
        const message = err instanceof Error ? err.message : 'Failed to start recording'
        setError(message)
      }
    },
    [startTimer, stopAllStreams]
  )

  const pauseRecording = useCallback((): void => {
    if (state !== 'recording') return
    micRecorderRef.current?.pause()
    systemRecorderRef.current?.pause()
    stopTimer()
    setState('paused')
  }, [state, stopTimer])

  const resumeRecording = useCallback((): void => {
    if (state !== 'paused') return
    micRecorderRef.current?.resume()
    systemRecorderRef.current?.resume()
    startTimer()
    setState('recording')
  }, [state, startTimer])

  const stopRecording = useCallback(
    async (spaceId: string): Promise<void> => {
      if (state === 'idle') return
      stopTimer()

      const mode = recordingModeRef.current

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

        await window.audio.saveRecording(noteId, spaceId, { micAudio, systemAudio, mode })

        micChunksRef.current = []
        systemChunksRef.current = []
        micRecorderRef.current = null
        systemRecorderRef.current = null
        setState('idle')
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to save recording'
        setError(message)
        setState('idle')
      }
    },
    [state, stopTimer, stopAllStreams, noteId]
  )

  return { state, startRecording, pauseRecording, resumeRecording, stopRecording, duration, error }
}
