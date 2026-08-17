import { type FC, useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { MeetingProgressView } from '@renderer/components/meeting/MeetingProgressView'
import { useMeetingLifecycle } from '@renderer/hooks/useMeetingLifecycle'
import { meetingLanguageLabel } from '@renderer/lib/meetingLanguages'
import { summaryDepthLabel, type SummaryDepth } from '@renderer/lib/meetingSummary'
import type { MeetingMetadata } from '@preload/types'

interface MeetingReprocessDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  noteId: string
  spaceId: string
  folderId: string
  metadata: MeetingMetadata
  language: string
  summaryDepth: SummaryDepth
}

type ReprocessPhase = 'confirm' | 'processing' | 'error'

export const MeetingReprocessDialog: FC<MeetingReprocessDialogProps> = ({
  open,
  onOpenChange,
  noteId,
  spaceId,
  folderId,
  metadata,
  language,
  summaryDepth
}) => {
  const { reprocessMeeting, activeProcessingJob, processingProgress } = useMeetingLifecycle()
  const [phase, setPhase] = useState<ReprocessPhase>('confirm')
  const [error, setError] = useState<string | null>(null)

  const isProcessing = phase === 'processing'
  const isActive =
    activeProcessingJob?.kind === 'reprocess' && activeProcessingJob.noteId === noteId
  const progress = isActive ? processingProgress : null

  useEffect(() => {
    if (!open) {
      setPhase('confirm')
      setError(null)
    }
  }, [open])

  const runReprocess = useCallback(async (): Promise<void> => {
    if (!spaceId) return

    setPhase('processing')
    setError(null)

    try {
      await reprocessMeeting({
        noteId,
        spaceId,
        folderId,
        options: {
          mode: metadata.recordingMode,
          contentType: metadata.contentType ?? 'meeting',
          summaryDepth,
          recordingDate: metadata.recordingDate,
          durationSecs: metadata.duration,
          language
        }
      })

      toast.success('Meeting reprocessed')
      onOpenChange(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Reprocessing failed'
      setError(message)
      setPhase('error')
      toast.error(message)
    }
  }, [folderId, language, metadata, noteId, onOpenChange, reprocessMeeting, spaceId, summaryDepth])

  const handleOpenChange = (nextOpen: boolean): void => {
    if (isProcessing && !nextOpen) return
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onInteractOutside={(event) => {
          if (isProcessing) event.preventDefault()
        }}
        onEscapeKeyDown={(event) => {
          if (isProcessing) event.preventDefault()
        }}
      >
        {phase === 'confirm' && (
          <>
            <DialogHeader>
              <DialogTitle>Reprocess meeting?</DialogTitle>
              <DialogDescription>
                This reruns audio conversion, transcription, speaker identification, and summary
                generation. The note content and meeting metadata will be replaced only if the full
                pipeline succeeds. Your saved audio will be kept.
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              Language: {meetingLanguageLabel(language)} · Summary:{' '}
              {summaryDepthLabel(summaryDepth)}
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void runReprocess()}>
                Reprocess
              </Button>
            </div>
          </>
        )}

        {phase === 'processing' && (
          <>
            <DialogHeader>
              <DialogTitle>{isActive ? 'Reprocessing meeting' : 'Reprocessing queued'}</DialogTitle>
              <DialogDescription>
                {isActive
                  ? `Running the full pipeline in ${meetingLanguageLabel(language)}.`
                  : 'Waiting for the current meeting processing job to finish.'}
              </DialogDescription>
            </DialogHeader>

            <MeetingProgressView
              progress={progress}
              title={isActive ? 'Reprocessing meeting...' : 'Waiting for available resources...'}
            />
          </>
        )}

        {phase === 'error' && (
          <>
            <DialogHeader>
              <DialogTitle>Reprocessing failed</DialogTitle>
              <DialogDescription>
                The existing note and its saved audio were not changed.
              </DialogDescription>
            </DialogHeader>

            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button type="button" onClick={() => void runReprocess()}>
                Retry
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
