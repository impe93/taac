import { type FC, type UIEvent, useEffect, useRef, useState } from 'react'
import { Loader2, Info } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { cn } from '@renderer/lib/utils'
import { useMeetingLifecycle } from '@renderer/hooks/useMeetingLifecycle'

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** Scroll slack (px) under which the view counts as "pinned to bottom" */
const AUTO_SCROLL_SLACK_PX = 48

export interface LiveTranscriptProps {
  className?: string
}

/**
 * Scrolling live transcript shown while a meeting is being recorded.
 * Segments arrive from the realtime ASR session (mic and system tracks
 * merged chronologically); at meeting end the same segments become the
 * final transcript, enriched with speakers by diarization.
 */
export const LiveTranscript: FC<LiveTranscriptProps> = ({ className }) => {
  const { liveSegments, liveTranscriptionStatus } = useMeetingLifecycle()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [pinnedToBottom, setPinnedToBottom] = useState(true)

  useEffect(() => {
    const container = scrollRef.current
    if (container && pinnedToBottom) {
      container.scrollTop = container.scrollHeight
    }
  }, [liveSegments.length, pinnedToBottom])

  if (liveTranscriptionStatus === 'idle') return null

  const handleScroll = (event: UIEvent<HTMLDivElement>): void => {
    const el = event.currentTarget
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setPinnedToBottom(distanceFromBottom < AUTO_SCROLL_SLACK_PX)
  }

  return (
    <Card className={cn('flex min-h-0 flex-col', className)}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {liveTranscriptionStatus === 'starting' && (
            <>
              <Loader2 className="size-4 animate-spin text-primary" />
              <span>Warming up live transcription...</span>
            </>
          )}
          {liveTranscriptionStatus === 'live' && (
            <>
              <span className="relative flex size-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
                <span className="relative inline-flex size-2.5 rounded-full bg-red-500" />
              </span>
              <span>Live transcript</span>
            </>
          )}
          {liveTranscriptionStatus === 'unavailable' && (
            <>
              <Info className="size-4 text-muted-foreground" />
              <span className="font-normal text-muted-foreground">
                Live transcription unavailable — the transcript will be generated after the meeting
                ends.
              </span>
            </>
          )}
        </CardTitle>
      </CardHeader>
      {liveTranscriptionStatus !== 'unavailable' && (
        <CardContent className="min-h-0 flex-1 pt-0">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="h-full max-h-full overflow-y-auto pr-1"
          >
            {liveSegments.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground/70">
                Waiting for speech...
              </p>
            ) : (
              <div className="flex flex-col gap-2 pb-2">
                {liveSegments.map((segment) => (
                  <div
                    key={`${segment.track}-${segment.startTime}`}
                    className="flex items-baseline gap-3"
                  >
                    <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                      {formatTimestamp(segment.startTime)}
                    </span>
                    <p className="text-sm leading-relaxed text-foreground">{segment.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  )
}
