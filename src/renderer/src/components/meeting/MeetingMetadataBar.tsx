import { type FC, useEffect, useState } from 'react'
import { Calendar, Clock, Languages, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'
import { useAppDispatch } from '@renderer/store/hooks'
import { updateNote } from '@renderer/store/slices/notesTreeSlice'
import { MEETING_LANGUAGE_CHOICES, meetingLanguageLabel } from '@renderer/lib/meetingLanguages'
import { MeetingReprocessDialog } from '@renderer/components/meeting/MeetingReprocessDialog'
import type { MeetingMetadata } from '@preload/types'

const IS_DEV = import.meta.env.DEV

interface MeetingMetadataBarProps {
  metadata: MeetingMetadata
  noteId: string
  spaceId: string
  folderId: string
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export const MeetingMetadataBar: FC<MeetingMetadataBarProps> = ({
  metadata,
  noteId,
  spaceId,
  folderId
}) => {
  const dispatch = useAppDispatch()
  const [selectedLanguage, setSelectedLanguage] = useState(metadata.language)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [hasStoredRecording, setHasStoredRecording] = useState(false)
  const [reprocessOpen, setReprocessOpen] = useState(false)

  useEffect(() => {
    setSelectedLanguage(metadata.language)
  }, [metadata.language])

  useEffect(() => {
    if (!IS_DEV || !spaceId) {
      setHasStoredRecording(false)
      return
    }

    let cancelled = false
    void window.audio.hasStoredRecording(noteId, spaceId).then((exists) => {
      if (!cancelled) setHasStoredRecording(exists)
    })

    return (): void => {
      cancelled = true
    }
  }, [noteId, spaceId])

  const date = new Date(metadata.recordingDate).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })

  // Production: correcting the language re-runs summarization on the stored transcript.
  const handleLanguageChange = async (newLanguage: string): Promise<void> => {
    setSelectedLanguage(newLanguage)
    if (IS_DEV || newLanguage === metadata.language || isRegenerating) return

    setIsRegenerating(true)
    try {
      const result = await window.audio.regenerateSummary({
        speakers: metadata.speakers,
        transcription: metadata.transcription,
        language: newLanguage
      })

      await dispatch(
        updateNote({
          spaceId,
          folderId,
          noteId,
          updates: {
            content: result.content,
            meetingMetadata: {
              ...metadata,
              language: result.language,
              actionItems: result.actionItems
            }
          }
        })
      ).unwrap()

      if (result.summarizationError) {
        toast.warning(`Summary regenerated with issues: ${result.summarizationError}`)
      } else {
        toast.success('Summary regenerated')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to regenerate summary')
    } finally {
      setIsRegenerating(false)
    }
  }

  const handleReprocessClick = (): void => {
    if (!hasStoredRecording) {
      toast.error(
        'No saved audio files found. Enable "Keep audio recordings after transcription" in Settings.'
      )
      return
    }
    setReprocessOpen(true)
  }

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="secondary" className="gap-1.5 font-normal">
          <Calendar className="size-3" />
          {date}
        </Badge>
        <Badge variant="secondary" className="gap-1.5 font-normal">
          <Clock className="size-3" />
          {formatDuration(metadata.duration)}
        </Badge>

        {metadata.language && (
          <div className="flex items-center gap-1">
            <Select
              value={selectedLanguage}
              onValueChange={handleLanguageChange}
              disabled={isRegenerating || !spaceId}
            >
              <SelectTrigger
                aria-label="Meeting language"
                className="h-auto w-auto gap-1.5 rounded-md border-0 bg-secondary px-2 py-0.5 text-xs font-normal shadow-none focus:ring-0"
              >
                {isRegenerating ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Languages className="size-3" />
                )}
                <SelectValue>{meetingLanguageLabel(selectedLanguage)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {MEETING_LANGUAGE_CHOICES.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {IS_DEV && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="size-7"
                    aria-label="Reprocess meeting from saved audio"
                    disabled={!spaceId || !hasStoredRecording}
                    onClick={handleReprocessClick}
                  >
                    <RefreshCw className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>
                    {hasStoredRecording
                      ? 'Dev: re-run full pipeline from saved audio'
                      : 'No saved audio — enable "Keep audio recordings" in Settings'}
                  </p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        )}

        {isRegenerating && (
          <span className="text-xs text-muted-foreground animate-pulse">Regenerating summary…</span>
        )}
      </div>

      {IS_DEV && (
        <MeetingReprocessDialog
          open={reprocessOpen}
          onOpenChange={setReprocessOpen}
          noteId={noteId}
          spaceId={spaceId}
          folderId={folderId}
          metadata={metadata}
          language={selectedLanguage}
        />
      )}
    </>
  )
}
