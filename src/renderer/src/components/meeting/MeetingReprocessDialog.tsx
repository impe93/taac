import { type FC, useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { useAppDispatch } from '@renderer/store/hooks'
import { updateNote } from '@renderer/store/slices/notesTreeSlice'
import { MeetingProgressView } from '@renderer/components/meeting/MeetingProgressView'
import { meetingLanguageLabel } from '@renderer/lib/meetingLanguages'
import type { ProcessingProgress } from '@preload/index.d'
import type { MeetingMetadata } from '@preload/types'

interface MeetingReprocessDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  noteId: string
  spaceId: string
  folderId: string
  metadata: MeetingMetadata
  language: string
}

export const MeetingReprocessDialog: FC<MeetingReprocessDialogProps> = ({
  open,
  onOpenChange,
  noteId,
  spaceId,
  folderId,
  metadata,
  language
}) => {
  const dispatch = useAppDispatch()
  const [progress, setProgress] = useState<ProcessingProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const hasStartedRef = useRef(false)

  const runReprocess = useCallback(async (): Promise<void> => {
    if (!spaceId) return

    setIsProcessing(true)
    setError(null)
    setProgress(null)

    try {
      const result = await window.audio.reprocessFromDisk(noteId, spaceId, {
        mode: metadata.recordingMode,
        recordingDate: metadata.recordingDate,
        durationSecs: metadata.duration,
        language
      })

      await dispatch(
        updateNote({
          spaceId,
          folderId,
          noteId,
          updates: {
            content: result.content,
            meetingMetadata: result.metadata
          }
        })
      ).unwrap()

      if (result.summarizationError) {
        toast.warning(`Meeting reprocessed, but the summary failed: ${result.summarizationError}`)
      } else {
        toast.success('Meeting reprocessed')
      }

      onOpenChange(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Reprocessing failed'
      setError(message)
      toast.error(message)
    } finally {
      setIsProcessing(false)
      setProgress(null)
      hasStartedRef.current = false
    }
  }, [dispatch, folderId, language, metadata, noteId, onOpenChange, spaceId])

  useEffect(() => {
    if (!open) {
      hasStartedRef.current = false
      setProgress(null)
      setError(null)
      setIsProcessing(false)
      return
    }

    if (hasStartedRef.current) return
    hasStartedRef.current = true
    void runReprocess()
  }, [open, runReprocess])

  useEffect(() => {
    if (!open) return

    return window.audio.onProcessingProgress((data: ProcessingProgress) => {
      if (data.noteId === noteId) {
        setProgress(data)
      }
    })
  }, [noteId, open])

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
        <DialogHeader>
          <DialogTitle>Reprocessing meeting</DialogTitle>
          <DialogDescription>
            Running the full transcription and summarization pipeline in{' '}
            {meetingLanguageLabel(language)}.
          </DialogDescription>
        </DialogHeader>

        <MeetingProgressView
          progress={progress}
          title={isProcessing ? 'Reprocessing meeting...' : 'Reprocessing complete'}
        />

        {error && (
          <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
        )}

        {error && !isProcessing && (
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button type="button" onClick={() => void runReprocess()}>
              Retry
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
