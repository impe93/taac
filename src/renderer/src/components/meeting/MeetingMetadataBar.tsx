import { type FC } from 'react'
import { Calendar, Clock, Languages } from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import type { MeetingMetadata } from '@preload/types'

interface MeetingMetadataBarProps {
  metadata: MeetingMetadata
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function formatLanguage(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code.toUpperCase()
  } catch {
    return code.toUpperCase()
  }
}

export const MeetingMetadataBar: FC<MeetingMetadataBarProps> = ({ metadata }) => {
  const date = new Date(metadata.recordingDate).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })

  return (
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
        <Badge variant="secondary" className="gap-1.5 font-normal">
          <Languages className="size-3" />
          {formatLanguage(metadata.language)}
        </Badge>
      )}
    </div>
  )
}
