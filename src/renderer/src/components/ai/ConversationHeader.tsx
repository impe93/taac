import { type FC, useState, useRef, useEffect, type KeyboardEvent } from 'react'
import { ArrowLeft, MoreVertical, Trash2, FileX2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Badge } from '@renderer/components/ui/badge'
import { Input } from '@renderer/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
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
  useUpdateConversationTitle,
  useDeleteConversation,
  useRemoveNoteFromConversation
} from '@renderer/hooks/useConversations'
import type { Conversation } from '@main/ai/types'

interface ConversationHeaderProps {
  conversation: Conversation
  onTitleChange?: (newTitle: string) => void
  onDelete?: () => void
  onClose: () => void
  className?: string
}

export const ConversationHeader: FC<ConversationHeaderProps> = ({
  conversation,
  onTitleChange,
  onDelete,
  onClose,
  className
}) => {
  const updateTitle = useUpdateConversationTitle()
  const deleteConversation = useDeleteConversation()
  const removeNote = useRemoveNoteFromConversation()

  // Inline edit state
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(conversation.title)
  const inputRef = useRef<HTMLInputElement>(null)

  // Delete confirmation dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  // Clear context confirmation dialog state
  const [clearContextDialogOpen, setClearContextDialogOpen] = useState(false)

  // Sync edit value when conversation title changes externally
  useEffect(() => {
    if (!isEditing) {
      setEditValue(conversation.title)
    }
  }, [conversation.title, isEditing])

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleTitleClick = (): void => {
    setIsEditing(true)
  }

  const handleTitleSubmit = (): void => {
    const trimmedValue = editValue.trim()
    if (!trimmedValue || trimmedValue === conversation.title) {
      setEditValue(conversation.title)
      setIsEditing(false)
      return
    }

    updateTitle.mutate(
      { conversationId: conversation.id, title: trimmedValue },
      {
        onSuccess: () => {
          setIsEditing(false)
          onTitleChange?.(trimmedValue)
        },
        onError: () => {
          setEditValue(conversation.title)
          setIsEditing(false)
        }
      }
    )
  }

  const handleTitleKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleTitleSubmit()
    } else if (e.key === 'Escape') {
      setEditValue(conversation.title)
      setIsEditing(false)
    }
  }

  const handleTitleBlur = (): void => {
    handleTitleSubmit()
  }

  const handleDeleteClick = (): void => {
    setDeleteDialogOpen(true)
  }

  const handleDeleteConfirm = (): void => {
    deleteConversation.mutate(conversation.id, {
      onSuccess: () => {
        setDeleteDialogOpen(false)
        onDelete?.()
      }
    })
  }

  const handleClearContextClick = (): void => {
    if (conversation.noteContext.length === 0) return
    setClearContextDialogOpen(true)
  }

  const handleClearContextConfirm = (): void => {
    // Remove all notes from context one by one
    const removePromises = conversation.noteContext.map((noteRef) =>
      removeNote.mutateAsync({
        conversationId: conversation.id,
        noteId: noteRef.noteId
      })
    )

    Promise.all(removePromises).finally(() => {
      setClearContextDialogOpen(false)
    })
  }

  const noteContextCount = conversation.noteContext.length

  return (
    <div className={cn('flex items-center gap-3 px-4 py-3 border-b bg-background', className)}>
      {/* Back/Close button */}
      <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0">
        <ArrowLeft className="size-4" />
        <span className="sr-only">Close conversation</span>
      </Button>

      {/* Title section */}
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <Input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleTitleKeyDown}
            onBlur={handleTitleBlur}
            className="h-8 text-sm font-medium"
            disabled={updateTitle.isPending}
          />
        ) : (
          <button
            onClick={handleTitleClick}
            className="text-left w-full group"
            title="Click to edit title"
          >
            <h2 className="text-sm font-medium truncate group-hover:text-primary transition-colors">
              {conversation.title}
            </h2>
          </button>
        )}
      </div>

      {/* Model badge */}
      <Badge variant="secondary" className="shrink-0 text-xs">
        {conversation.modelId}
      </Badge>

      {/* Note context count badge */}
      {noteContextCount > 0 && (
        <Badge variant="outline" className="shrink-0 text-xs">
          {noteContextCount} {noteContextCount === 1 ? 'note' : 'notes'}
        </Badge>
      )}

      {/* Actions menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="shrink-0">
            <MoreVertical className="size-4" />
            <span className="sr-only">Conversation actions</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={handleClearContextClick}
            disabled={noteContextCount === 0 || removeNote.isPending}
          >
            <FileX2 className="size-4 mr-2" />
            Clear context
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={handleDeleteClick}>
            <Trash2 className="size-4 mr-2" />
            Delete conversation
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Conversation</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{conversation.title}&quot;? This action cannot
              be undone and all messages will be permanently lost.
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

      {/* Clear Context Confirmation Dialog */}
      <Dialog open={clearContextDialogOpen} onOpenChange={setClearContextDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear Note Context</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove all {noteContextCount} note
              {noteContextCount === 1 ? '' : 's'} from this conversation&apos;s context? The AI will
              no longer reference these notes in future responses.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearContextDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleClearContextConfirm} disabled={removeNote.isPending}>
              {removeNote.isPending ? 'Clearing...' : 'Clear Context'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
