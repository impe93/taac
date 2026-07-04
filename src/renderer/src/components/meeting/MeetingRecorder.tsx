import { type FC, useState, useCallback, useMemo } from 'react'
import { Mic, Pause, Play, Square, Wifi, Users } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent } from '@renderer/components/ui/card'
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { cn } from '@renderer/lib/utils'
import { useMeetingLifecycle } from '@renderer/hooks/useMeetingLifecycle'
import { useConfig } from '@renderer/hooks/useConfig'
import { MEETING_LANGUAGE_OPTIONS } from '@renderer/lib/meetingLanguages'

type RecordingMode = 'remote' | 'in-person'

interface MeetingRecorderProps {
  noteId: string
  spaceId: string
  folderId: string
  className?: string
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':')
}

export const MeetingRecorder: FC<MeetingRecorderProps> = ({
  noteId,
  spaceId,
  folderId,
  className
}) => {
  const { data: meetingConfig } = useConfig('meeting')
  const [mode, setMode] = useState<RecordingMode>(meetingConfig?.defaultRecordingMode ?? 'remote')
  const [language, setLanguage] = useState<string>(meetingConfig?.defaultLanguage ?? 'auto')
  const {
    recordingSession,
    isRecordingBusy,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    recordingStartFailure,
    clearRecordingStartFailure
  } = useMeetingLifecycle()

  const isThisNoteRecording =
    recordingSession !== null &&
    recordingSession.noteId === noteId &&
    (recordingSession.state === 'recording' || recordingSession.state === 'paused')

  const isBlockedByOtherRecording =
    isRecordingBusy && recordingSession !== null && recordingSession.noteId !== noteId

  const handleStart = useCallback(async (): Promise<void> => {
    if (!spaceId) return
    await startRecording({ noteId, spaceId, folderId, mode, language })
  }, [noteId, spaceId, folderId, mode, language, startRecording])

  const handleStop = useCallback(async (): Promise<void> => {
    await stopRecording()
  }, [stopRecording])

  const isRecording = isThisNoteRecording && recordingSession?.state === 'recording'
  const isPaused = isThisNoteRecording && recordingSession?.state === 'paused'
  const isActive = isRecording || isPaused

  const duration = useMemo(
    () => (isThisNoteRecording && recordingSession ? recordingSession.duration : 0),
    [isThisNoteRecording, recordingSession]
  )

  const startError = recordingStartFailure?.noteId === noteId ? recordingStartFailure.message : null

  return (
    <div className={cn('flex items-center justify-center flex-1 p-6', className)}>
      <Card className="w-full max-w-md">
        <CardContent className="pt-8 pb-8 px-8 flex flex-col items-center gap-6">
          {isBlockedByOtherRecording ? (
            <p className="text-sm text-muted-foreground text-center">
              Another meeting recording is in progress. Stop or finish it before starting a new one
              here.
            </p>
          ) : !isActive ? (
            <>
              <div className="flex flex-col items-center gap-3">
                <div className="relative flex size-20 items-center justify-center">
                  <span className="absolute inset-0 rounded-full border-2 border-primary/50 animate-[tnpulse_2.4s_ease-out_infinite]" />
                  <div className="relative flex size-20 items-center justify-center rounded-full border border-primary/30 bg-primary/10">
                    <Mic className="size-8 text-primary" />
                  </div>
                </div>
                <p className="text-lg font-semibold">Ready to Record</p>
                <p className="text-sm text-muted-foreground text-center">
                  Select your recording mode and start capturing the meeting
                </p>
              </div>

              <div className="flex flex-col items-center gap-2 w-full">
                <span className="text-sm font-medium text-muted-foreground">Recording Mode</span>
                <ToggleGroup
                  type="single"
                  value={mode}
                  onValueChange={(v) => v && setMode(v as RecordingMode)}
                  className="w-full"
                >
                  <ToggleGroupItem value="remote" className="flex-1 gap-2" aria-label="Remote mode">
                    <Wifi className="size-4" />
                    Remote
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="in-person"
                    className="flex-1 gap-2"
                    aria-label="In-person mode"
                  >
                    <Users className="size-4" />
                    In-person
                  </ToggleGroupItem>
                </ToggleGroup>
                <p className="text-xs text-muted-foreground text-center">
                  {mode === 'remote'
                    ? 'Captures microphone + system audio (Zoom, Teams, Meet)'
                    : 'Captures microphone only (all participants in same room)'}
                </p>
              </div>

              <div className="flex flex-col items-center gap-2 w-full">
                <span className="text-sm font-medium text-muted-foreground">Language</span>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger className="w-full" aria-label="Meeting language">
                    <SelectValue placeholder="Auto-detect" />
                  </SelectTrigger>
                  <SelectContent>
                    {MEETING_LANGUAGE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground text-center">
                  {language === 'auto'
                    ? 'The spoken language is detected automatically'
                    : 'Transcription and summary will use the selected language'}
                </p>
              </div>

              {startError && (
                <div className="flex w-full flex-col gap-2">
                  <p className="text-sm text-destructive text-center bg-destructive/10 rounded-md px-3 py-2 w-full">
                    {startError}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={clearRecordingStartFailure}
                  >
                    Dismiss
                  </Button>
                </div>
              )}

              <Button size="lg" className="w-full gap-2" onClick={handleStart}>
                <Mic className="size-5" />
                Start Recording
              </Button>
            </>
          ) : (
            <>
              <div className="flex flex-col items-center gap-3">
                <div className="relative size-16 rounded-full bg-destructive/10 flex items-center justify-center">
                  <div
                    className={cn(
                      'size-4 rounded-full bg-destructive',
                      isRecording && 'animate-pulse'
                    )}
                  />
                </div>
                <p className="text-sm font-medium text-muted-foreground">
                  {isRecording ? 'Recording in progress...' : 'Recording paused'}
                </p>
              </div>

              <div className="text-4xl font-mono font-bold tabular-nums tracking-wider">
                {formatDuration(duration)}
              </div>

              <div className="flex gap-3 w-full">
                <Button
                  variant="outline"
                  className="flex-1 gap-2"
                  onClick={isRecording ? pauseRecording : resumeRecording}
                >
                  {isRecording ? (
                    <>
                      <Pause className="size-4" />
                      Pause
                    </>
                  ) : (
                    <>
                      <Play className="size-4" />
                      Resume
                    </>
                  )}
                </Button>
                <Button variant="destructive" className="flex-1 gap-2" onClick={handleStop}>
                  <Square className="size-4" />
                  Stop Recording
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
