import { type FC } from 'react'
import { User, Bot, FileText } from 'lucide-react'
import { Avatar, AvatarFallback } from '@renderer/components/ui/avatar'
import { Badge } from '@renderer/components/ui/badge'
import { cn } from '@renderer/lib/utils'
import type { ChatMessage as ChatMessageType } from '@main/ai/types'
import ReactMarkdown from 'react-markdown'

interface ChatMessageProps {
  message: ChatMessageType
  isStreaming?: boolean
  onNoteClick?: (noteId: string) => void
  className?: string
}

const formatTimestamp = (timestamp: string): string => {
  const date = new Date(timestamp)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()

  const timeStr = date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit'
  })

  if (isToday) {
    return timeStr
  }

  const dateStr = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric'
  })

  return `${dateStr}, ${timeStr}`
}

const roleConfig = {
  user: {
    label: 'You',
    icon: User,
    avatarClass: 'bg-primary text-primary-foreground'
  },
  assistant: {
    label: 'Assistant',
    icon: Bot,
    avatarClass: 'bg-muted text-muted-foreground'
  },
  system: {
    label: 'System',
    icon: Bot,
    avatarClass: 'bg-muted text-muted-foreground'
  }
} as const

export const ChatMessage: FC<ChatMessageProps> = ({
  message,
  isStreaming = false,
  onNoteClick,
  className
}) => {
  const { role, content, timestamp, noteReferences } = message
  const config = roleConfig[role]
  const Icon = config.icon
  const isUser = role === 'user'

  // De-duplicate note references by noteId, keeping the one with highest relevance score
  const uniqueNoteReferences = noteReferences
    ? Object.values(
        noteReferences.reduce(
          (acc, ref) => {
            const existing = acc[ref.noteId]
            // Keep the reference with higher relevance score, or the first one if scores are equal
            if (
              !existing ||
              (ref.relevanceScore ?? 0) > (existing.relevanceScore ?? 0)
            ) {
              acc[ref.noteId] = ref
            }
            return acc
          },
          {} as Record<string, (typeof noteReferences)[0]>
        )
      )
    : undefined

  return (
    <div
      className={cn('flex gap-3', isUser ? 'flex-row-reverse' : 'flex-row', className)}
      data-role={role}
    >
      {/* Avatar */}
      <Avatar className={cn('size-8 shrink-0', config.avatarClass)}>
        <AvatarFallback className={config.avatarClass}>
          <Icon className="size-4" />
        </AvatarFallback>
      </Avatar>

      {/* Message Content */}
      <div className={cn('flex flex-col gap-1 max-w-[80%]', isUser ? 'items-end' : 'items-start')}>
        {/* Header: Role + Timestamp */}
        <div
          className={cn(
            'flex items-center gap-2 text-xs text-muted-foreground',
            isUser ? 'flex-row-reverse' : 'flex-row'
          )}
        >
          <span className="font-medium">{config.label}</span>
          <span>·</span>
          <time dateTime={timestamp}>{formatTimestamp(timestamp)}</time>
        </div>

        {/* Message Bubble */}
        <div
          className={cn(
            'rounded-2xl px-4 py-2.5 text-sm',
            isUser
              ? 'bg-primary text-primary-foreground rounded-tr-sm'
              : 'bg-muted text-foreground rounded-tl-sm'
          )}
        >
          {/* Content rendering: plain text for user, markdown for assistant */}
          {isUser ? (
            <div className="whitespace-pre-wrap break-words">{content}</div>
          ) : (
            <div
              className="break-words
                [&_p]:my-1 [&_p:last-child]:mb-0
                [&_h1]:text-base [&_h1]:font-bold [&_h1]:my-1.5
                [&_h2]:text-sm [&_h2]:font-bold [&_h2]:my-1.5
                [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:my-1
                [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:my-1
                [&_ol]:list-decimal [&_ol]:pl-4 [&_ol]:my-1
                [&_li]:my-0.5
                [&_code]:bg-black/10 dark:[&_code]:bg-white/10 [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em]
                [&_pre]:bg-black/10 dark:[&_pre]:bg-white/10 [&_pre]:rounded-md [&_pre]:p-2 [&_pre]:my-1 [&_pre_code]:bg-transparent [&_pre_code]:p-0
                [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:opacity-75
                [&_strong]:font-semibold [&_em]:italic"
            >
              <ReactMarkdown>{content}</ReactMarkdown>
              {isStreaming && (
                <span className="inline-block w-2 h-4 ml-0.5 bg-current animate-pulse rounded-sm" />
              )}
            </div>
          )}
        </div>

        {/* Note References */}
        {uniqueNoteReferences && uniqueNoteReferences.length > 0 && (
          <div
            className={cn('flex flex-wrap gap-1.5 mt-1', isUser ? 'justify-end' : 'justify-start')}
          >
            {uniqueNoteReferences.map((ref) => (
              <Badge
                key={ref.noteId}
                variant="outline"
                className={cn(
                  'gap-1 text-xs font-normal bg-background/50',
                  onNoteClick && 'hover:bg-accent cursor-pointer'
                )}
                title={ref.excerpt}
                onClick={onNoteClick ? () => onNoteClick(ref.noteId) : undefined}
              >
                <FileText className="size-3" />
                <span className="max-w-[150px] truncate">{ref.title}</span>
                {ref.relevanceScore !== undefined && (
                  <span className="text-muted-foreground">
                    {Math.round(ref.relevanceScore)}%
                  </span>
                )}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
