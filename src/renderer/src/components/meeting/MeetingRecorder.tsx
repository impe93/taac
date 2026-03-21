import { type FC, useState, useCallback } from 'react'
import { Mic, Pause, Play, Square, Wifi, Users } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent } from '@renderer/components/ui/card'
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group'
import { cn } from '@renderer/lib/utils'
import { useMeetingRecorder } from '@renderer/hooks/useMeetingRecorder'

type RecordingMode = 'remote' | 'in-person'

interface MeetingRecorderProps {
  noteId: string
  spaceId: string
  onRecordingComplete: () => void
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
  onRecordingComplete
}) => {
  const [mode, setMode] = useState<RecordingMode>('remote')
  const { state, startRecording, pauseRecording, resumeRecording, stopRecording, duration, error } =
    useMeetingRecorder(noteId)

  const handleStart = useCallback(async (): Promise<void> => {
    await startRecording(mode)
  }, [mode, startRecording])

  const handleStop = useCallback(async (): Promise<void> => {
    await stopRecording(spaceId)
    onRecordingComplete()
  }, [stopRecording, spaceId, onRecordingComplete])

  const isRecording = state === 'recording'
  const isPaused = state === 'paused'
  const isActive = isRecording || isPaused

  return (
    <div className="flex items-center justify-center flex-1 p-6">
      <Card className="w-full max-w-md">
        <CardContent className="pt-8 pb-8 px-8 flex flex-col items-center gap-6">
          {!isActive ? (
            <>
              {/* Pre-recording state */}
              <div className="flex flex-col items-center gap-2">
                <div className="size-16 rounded-full bg-muted flex items-center justify-center">
                  <Mic className="size-8 text-muted-foreground" />
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

              {error && (
                <p className="text-sm text-destructive text-center bg-destructive/10 rounded-md px-3 py-2 w-full">
                  {error}
                </p>
              )}

              <Button size="lg" className="w-full gap-2" onClick={handleStart}>
                <Mic className="size-5" />
                Start Recording
              </Button>
            </>
          ) : (
            <>
              {/* Recording / paused state */}
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
