import { type FC } from 'react'
import { Check, Loader2, Circle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Progress } from '@renderer/components/ui/progress'
import { cn } from '@renderer/lib/utils'
import type { ProcessingProgress } from '@preload/index.d'

interface Stage {
  key: string
  label: string
  index: number
}

const STAGE_LABELS: Record<string, string> = {
  converting: 'Converting audio',
  transcribing: 'Transcribing',
  diarizing: 'Identifying speakers',
  summarizing: 'Generating summary'
}

/** Whisper post-processing pipeline; realtime runs send their own 3-stage list */
const DEFAULT_STAGE_KEYS = ['converting', 'transcribing', 'diarizing', 'summarizing']

export interface MeetingProgressViewProps {
  progress: ProcessingProgress | null
  title?: string
  className?: string
}

export const MeetingProgressView: FC<MeetingProgressViewProps> = ({
  progress,
  title = 'Processing your meeting...',
  className
}) => {
  const stageKeys = progress?.stages ?? DEFAULT_STAGE_KEYS
  const stages: Stage[] = stageKeys.map((key, i) => ({
    key,
    label: STAGE_LABELS[key] ?? key,
    index: i + 1
  }))

  const currentStageIndex = progress?.currentStage ?? 0
  const overallPercentage = progress
    ? Math.max(0, Math.round(((currentStageIndex - 1) * 100 + progress.percentage) / stages.length))
    : 0

  const getStageStatus = (stage: Stage): 'done' | 'active' | 'pending' => {
    if (!progress) return 'pending'
    if (stage.index < currentStageIndex) return 'done'
    if (stage.index === currentStageIndex) return 'active'
    return 'pending'
  }

  return (
    <Card className={cn('w-full', className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-3">
          {stages.map((stage) => {
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
      </CardContent>
    </Card>
  )
}
