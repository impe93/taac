import { type FC, useCallback, useMemo } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { Pause, Play, Square, Mic, Loader2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import { useMeetingLifecycle } from '@renderer/hooks/useMeetingLifecycle'
import { useAppSelector } from '@renderer/store/hooks'
import { selectNoteById } from '@renderer/store/slices/notesTreeSlice'

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':')
}

export const MeetingRecordingSidebarPanel: FC = () => {
  const navigate = useNavigate()
  const {
    recordingSession,
    isRecordingBusy,
    pauseRecording,
    resumeRecording,
    stopRecording,
    processingQueue,
    activeProcessingJob,
    processingProgress,
    processingFailure,
    clearProcessingFailure
  } = useMeetingLifecycle()

  const currentNoteId = useRouterState({
    select: (s) => {
      const m = s.matches.find((x) => x.routeId === '/note/$noteId')
      const id = m?.params?.noteId
      return typeof id === 'string' ? id : undefined
    }
  })

  const recordingNoteId = recordingSession?.noteId
  const recordingNote = useAppSelector((state) =>
    recordingNoteId ? selectNoteById(recordingNoteId)(state) : undefined
  )

  const activeProcessingNoteId = activeProcessingJob?.noteId
  const activeProcessingNote = useAppSelector((state) =>
    activeProcessingNoteId ? selectNoteById(activeProcessingNoteId)(state) : undefined
  )

  const showRecordingStrip = useMemo(() => {
    if (!recordingSession || !isRecordingBusy) return false
    if (!currentNoteId) return true
    return currentNoteId !== recordingSession.noteId
  }, [recordingSession, isRecordingBusy, currentNoteId])

  const showProcessingStrip = useMemo(() => {
    if (processingQueue.length === 0 || !activeProcessingJob) return false
    if (!currentNoteId) return true
    return currentNoteId !== activeProcessingJob.noteId
  }, [processingQueue.length, activeProcessingJob, currentNoteId])

  const showProcessingFailureStrip = useMemo(() => {
    if (!processingFailure) return false
    if (!currentNoteId) return true
    return currentNoteId !== processingFailure.noteId
  }, [processingFailure, currentNoteId])

  const handleOpenRecordingNote = useCallback((): void => {
    if (!recordingSession) return
    void navigate({ to: '/note/$noteId', params: { noteId: recordingSession.noteId } })
  }, [navigate, recordingSession])

  const handleOpenProcessingNote = useCallback((): void => {
    if (!activeProcessingJob) return
    void navigate({ to: '/note/$noteId', params: { noteId: activeProcessingJob.noteId } })
  }, [navigate, activeProcessingJob])

  const handleStop = useCallback((): void => {
    void stopRecording()
  }, [stopRecording])

  const queuedCount = Math.max(0, processingQueue.length - 1)
  const progressForActive =
    processingProgress?.noteId === activeProcessingJob?.noteId ? processingProgress : null
  const overallPct = progressForActive
    ? Math.round(
        (((progressForActive.currentStage ?? 1) - 1) * 100 + progressForActive.percentage) / 4
      )
    : 0

  if (!showRecordingStrip && !showProcessingStrip && !showProcessingFailureStrip) return null

  return (
    <div className="flex flex-col gap-2 border-b border-border px-2 py-2 shrink-0">
      {showRecordingStrip && recordingSession && (
        <div
          className={cn(
            'rounded-md border border-border bg-muted/40 px-2 py-2 flex flex-col gap-2',
            'text-xs'
          )}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Mic className="size-3.5 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <p className="font-medium truncate">Recording</p>
              <p className="text-muted-foreground truncate" title={recordingNote?.title}>
                {recordingNote?.title ?? 'Meeting note'}
              </p>
            </div>
          </div>
          <p className="font-mono tabular-nums text-sm font-semibold text-center">
            {formatDuration(recordingSession.duration)}
          </p>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 h-7 gap-1 text-[11px] inline-flex items-center justify-center"
              onClick={recordingSession.state === 'recording' ? pauseRecording : resumeRecording}
            >
              {recordingSession.state === 'recording' ? (
                <>
                  <Pause className="size-3" />
                  Pause
                </>
              ) : (
                <>
                  <Play className="size-3" />
                  Resume
                </>
              )}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="flex-1 h-7 gap-1 text-[11px] inline-flex items-center justify-center"
              onClick={handleStop}
            >
              <Square className="size-3" />
              Stop
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[11px]"
            onClick={handleOpenRecordingNote}
          >
            Open meeting note
          </Button>
        </div>
      )}

      {showProcessingStrip && activeProcessingJob && (
        <div className="rounded-md border border-border bg-muted/40 px-2 py-2 flex flex-col gap-2 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
            <div className="min-w-0 flex-1">
              <p className="font-medium truncate">Processing meeting</p>
              <p className="text-muted-foreground truncate" title={activeProcessingNote?.title}>
                {activeProcessingNote?.title ?? 'Meeting note'}
              </p>
            </div>
          </div>
          {progressForActive && (
            <p className="text-muted-foreground capitalize">
              {progressForActive.stage.replace(/-/g, ' ')} · {progressForActive.percentage}%
            </p>
          )}
          <p className="font-mono tabular-nums text-center text-muted-foreground">
            {overallPct}% overall
          </p>
          {queuedCount > 0 && (
            <p className="text-muted-foreground text-center">{queuedCount} more in queue</p>
          )}
          {processingFailure?.noteId === activeProcessingJob.noteId && (
            <p className="text-destructive text-[11px] leading-snug">{processingFailure.message}</p>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[11px]"
            onClick={handleOpenProcessingNote}
          >
            Open meeting note
          </Button>
        </div>
      )}

      {showProcessingFailureStrip && processingFailure && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-2 flex flex-col gap-2 text-xs">
          <p className="font-medium text-destructive">Processing failed</p>
          <p className="text-destructive/90 text-[11px] leading-snug">
            {processingFailure.message}
          </p>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 h-7 text-[11px]"
              onClick={() =>
                void navigate({ to: '/note/$noteId', params: { noteId: processingFailure.noteId } })
              }
            >
              Open meeting note
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="flex-1 h-7 text-[11px]"
              onClick={clearProcessingFailure}
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
