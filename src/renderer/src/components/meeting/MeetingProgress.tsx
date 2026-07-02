import { type FC } from 'react'
import { useMeetingLifecycle } from '@renderer/hooks/useMeetingLifecycle'
import { MeetingProgressView } from '@renderer/components/meeting/MeetingProgressView'

interface MeetingProgressProps {
  noteId: string
}

export const MeetingProgress: FC<MeetingProgressProps> = ({ noteId }) => {
  const { activeProcessingJob, processingProgress } = useMeetingLifecycle()

  const progress = activeProcessingJob?.noteId === noteId ? processingProgress : null

  return (
    <div className="flex items-center justify-center flex-1 p-6">
      <MeetingProgressView progress={progress} className="max-w-md" />
    </div>
  )
}
