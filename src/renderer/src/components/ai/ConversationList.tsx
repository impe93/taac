import { type FC, useState } from 'react'
import { Plus, MessageSquare, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Badge } from '@renderer/components/ui/badge'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { Input } from '@renderer/components/ui/input'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@renderer/components/ui/context-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { cn } from '@renderer/lib/utils'
import {
  useConversations,
  useUpdateConversationTitle,
  useDeleteConversation
} from '@renderer/hooks/useConversations'

interface ConversationListProps {
  onSelectConversation: (id: string) => void
  selectedId?: string
  onNewConversation: () => void
  className?: string
}

/**
 * Formats a date string to a relative time (e.g., "2h ago", "3d ago")
 */
const formatRelativeTime = (dateString: string): string => {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)
  const diffWeeks = Math.floor(diffDays / 7)
  const diffMonths = Math.floor(diffDays / 30)

  if (diffSecs < 60) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffWeeks < 4) return `${diffWeeks}w ago`
  return `${diffMonths}mo ago`
}

/**
 * Truncates a string to a maximum length with ellipsis
 */
const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - 1) + '…'
}

const LoadingSkeleton: FC = () => (
  <div className="space-y-2 p-2">
    {[1, 2, 3].map((i) => (
      <div key={i} className="p-3 rounded-md border">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
          <Skeleton className="h-3 w-12" />
        </div>
      </div>
    ))}
  </div>
)

const EmptyState: FC = () => (
  <div className="flex flex-col items-center justify-center h-48 text-center px-4">
    <div className="rounded-full bg-muted p-3 mb-3">
      <MessageSquare className="size-6 text-muted-foreground" />
    </div>
    <p className="text-sm text-muted-foreground">No conversations yet</p>
  </div>
)

export const ConversationList: FC<ConversationListProps> = ({
  onSelectConversation,
  selectedId,
  onNewConversation,
  className
}) => {
  const { data: conversations, isLoading, error } = useConversations()
  const updateTitle = useUpdateConversationTitle()
  const deleteConversation = useDeleteConversation()

  // Rename dialog state
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [renameConversationId, setRenameConversationId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // Delete confirmation dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteConversationId, setDeleteConversationId] = useState<string | null>(null)

  const handleRenameClick = (conversationId: string, currentTitle: string): void => {
    setRenameConversationId(conversationId)
    setRenameValue(currentTitle)
    setRenameDialogOpen(true)
  }

  const handleRenameSubmit = (): void => {
    if (!renameConversationId || !renameValue.trim()) return

    updateTitle.mutate(
      { conversationId: renameConversationId, title: renameValue.trim() },
      {
        onSuccess: () => {
          setRenameDialogOpen(false)
          setRenameConversationId(null)
          setRenameValue('')
        }
      }
    )
  }

  const handleDeleteClick = (conversationId: string): void => {
    setDeleteConversationId(conversationId)
    setDeleteDialogOpen(true)
  }

  const handleDeleteConfirm = (): void => {
    if (!deleteConversationId) return

    deleteConversation.mutate(deleteConversationId, {
      onSuccess: () => {
        setDeleteDialogOpen(false)
        setDeleteConversationId(null)
      }
    })
  }

  // Sort conversations by most recent first
  const sortedConversations = [...(conversations || [])].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )

  if (error) {
    return (
      <div className={cn('flex flex-col', className)}>
        <div className="p-4 text-center text-sm text-destructive">Failed to load conversations</div>
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header with New Conversation button */}
      <div className="p-2 border-b shrink-0">
        <Button onClick={onNewConversation} className="w-full gap-2" size="sm">
          <Plus className="size-4" />
          New Conversation
        </Button>
      </div>

      {/* Conversation list */}
      <ScrollArea className="flex-1">
        {isLoading ? (
          <LoadingSkeleton />
        ) : sortedConversations.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-1 p-2">
            {sortedConversations.map((conversation) => (
              <ContextMenu key={conversation.id}>
                <ContextMenuTrigger asChild>
                  <button
                    onClick={() => onSelectConversation(conversation.id)}
                    className={cn(
                      'w-full text-left p-3 rounded-md border transition-colors',
                      'hover:bg-accent hover:border-accent',
                      selectedId === conversation.id
                        ? 'bg-accent border-accent ring-1 ring-ring'
                        : 'bg-background border-border'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        {/* Title */}
                        <p className="text-sm font-medium truncate">
                          {truncateText(conversation.title, 40)}
                        </p>

                        {/* Model badge and message count */}
                        <div className="flex items-center gap-2 mt-1.5">
                          <Badge variant="secondary" className="text-xs">
                            {conversation.modelId}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {conversation.messageCount}{' '}
                            {conversation.messageCount === 1 ? 'message' : 'messages'}
                          </span>
                        </div>
                      </div>

                      {/* Relative time */}
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatRelativeTime(conversation.updatedAt)}
                      </span>
                    </div>
                  </button>
                </ContextMenuTrigger>

                <ContextMenuContent>
                  <ContextMenuItem
                    onClick={() => handleRenameClick(conversation.id, conversation.title)}
                  >
                    <Pencil className="size-4 mr-2" />
                    Rename
                  </ContextMenuItem>
                  <ContextMenuItem
                    variant="destructive"
                    onClick={() => handleDeleteClick(conversation.id)}
                  >
                    <Trash2 className="size-4 mr-2" />
                    Delete
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Rename Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Conversation</DialogTitle>
            <DialogDescription>Enter a new name for this conversation.</DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder="Conversation title"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleRenameSubmit()
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleRenameSubmit}
              disabled={!renameValue.trim() || updateTitle.isPending}
            >
              {updateTitle.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Conversation</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this conversation? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={deleteConversation.isPending}
            >
              {deleteConversation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
