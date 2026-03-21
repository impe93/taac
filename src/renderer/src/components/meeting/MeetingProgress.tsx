import { type FC, useEffect, useRef } from 'react'
import { Check, Loader2, Circle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Progress } from '@renderer/components/ui/progress'
import { cn } from '@renderer/lib/utils'
import { useMeetingProcessing } from '@renderer/hooks/useMeetingProcessing'

type StageKey = 'converting' | 'transcribing' | 'diarizing' | 'summarizing'

interface Stage {
  key: StageKey
  label: string
  index: number
}

const STAGES: Stage[] = [
  { key: 'converting', label: 'Converting audio', index: 1 },
  { key: 'transcribing', label: 'Transcribing', index: 2 },
  { key: 'diarizing', label: 'Identifying speakers', index: 3 },
  { key: 'summarizing', label: 'Generating summary', index: 4 }
]

interface MeetingProgressProps {
  noteId: string
  spaceId: string
  onComplete: () => void
}

export const MeetingProgress: FC<MeetingProgressProps> = ({ noteId, spaceId, onComplete }) => {
  const { progress, startProcessing, error } = useMeetingProcessing(noteId)
  const startedRef = useRef(false)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    startProcessing(spaceId).then(() => {
      onCompleteRef.current()
    })
  }, [spaceId, startProcessing])

  const currentStageIndex = progress?.currentStage ?? 0
  const overallPercentage = progress
    ? Math.round(((currentStageIndex - 1) * 100 + progress.percentage) / 4)
    : 0

  const getStageStatus = (stage: Stage): 'done' | 'active' | 'pending' => {
    if (!progress) return 'pending'
    if (stage.index < currentStageIndex) return 'done'
    if (stage.index === currentStageIndex) return 'active'
    return 'pending'
  }

  return (
    <div className="flex items-center justify-center flex-1 p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Processing your meeting...</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-3">
            {STAGES.map((stage) => {
              const status = getStageStatus(stage)
              const isActive = status === 'active'
              const isDone = status === 'done'

              return (
                <div key={stage.key} className="flex items-center gap-3">
                  <div className="shrink-0 size-5 flex items-center justify-center">
                    {isDone ? (
                      <Check className="size-4 text-green-500" />
                    ) : isActive ? (
                      <Loader2 className="size-4 text-primary animate-spin" />
                    ) : (
                      <Circle className="size-4 text-muted-foreground/40" />
                    )}
                  </div>
                  <span
                    className={cn(
                      'text-sm flex-1',
                      isDone && 'text-muted-foreground',
                      isActive && 'text-foreground font-medium',
                      status === 'pending' && 'text-muted-foreground/60'
                    )}
                  >
                    {stage.label}
                  </span>
                  {isActive && progress && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {progress.percentage}%
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          <div className="flex flex-col gap-1.5">
            <Progress value={overallPercentage} className="h-2" />
            <p className="text-xs text-muted-foreground text-right tabular-nums">
              {overallPercentage}%
            </p>
          </div>

          {error && (
            <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
              {error}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
