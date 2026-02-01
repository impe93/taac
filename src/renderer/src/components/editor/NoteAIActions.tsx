import { type FC, useCallback } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Button } from '@renderer/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { Sparkles, MessageSquare, FileText, MessageCircleQuestion } from 'lucide-react'
import { useAIQuickAction, type AIQuickActionType } from '@renderer/hooks/useAIQuickAction'
import type { NoteReference } from '@main/ai/types'

interface NoteAIActionsProps {
  noteId: string
  spaceId: string
  title: string
  content: string
  className?: string
}

/**
 * Creates an excerpt from note content for the NoteReference
 */
function createExcerpt(content: string, maxLength = 200): string {
  // Remove markdown formatting for cleaner excerpt
  const cleanContent = content
    .replace(/#{1,6}\s/g, '') // Remove headers
    .replace(/\*\*|__|~~|`/g, '') // Remove bold, italic, strike, code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Convert links to text
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '') // Remove images
    .replace(/\n+/g, ' ') // Replace newlines with spaces
    .trim()

  if (cleanContent.length <= maxLength) {
    return cleanContent
  }

  return cleanContent.slice(0, maxLength).trim() + '...'
}

/**
 * Gets the currently selected text from the window
 */
function getSelectedText(): string {
  const selection = window.getSelection()
  return selection?.toString().trim() ?? ''
}

/**
 * Dropdown menu component for AI quick actions on a note.
 * Provides "Ask AI", "Summarize", and "Explain" actions.
 */
export const NoteAIActions: FC<NoteAIActionsProps> = ({
  noteId,
  spaceId,
  title,
  content,
  className
}) => {
  const { triggerAction, isProcessing } = useAIQuickAction()

  const handleAction = useCallback(
    (type: AIQuickActionType) => {
      const noteRef: NoteReference = {
        noteId,
        spaceId,
        title,
        excerpt: createExcerpt(content)
      }

      const selectedText = type === 'explain' ? getSelectedText() : undefined

      triggerAction({
        type,
        noteRef,
        selectedText
      })
    },
    [noteId, spaceId, title, content, triggerAction]
  )

  const selectedText = getSelectedText()
  const hasSelection = selectedText.length > 0

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={className}
              disabled={isProcessing}
              aria-label="Azioni AI"
            >
              <Sparkles className="size-4" />
              <span className="ml-1.5 hidden sm:inline">AI</span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>Azioni AI per questa nota</p>
        </TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={() => handleAction('ask')}>
          <MessageSquare className="mr-2 size-4" />
          <span>Chiedi all&apos;AI su questa nota</span>
        </DropdownMenuItem>

        <DropdownMenuItem onClick={() => handleAction('summarize')}>
          <FileText className="mr-2 size-4" />
          <span>Riassumi questa nota</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={() => handleAction('explain')} disabled={!hasSelection}>
          <MessageCircleQuestion className="mr-2 size-4" />
          <span>Spiega il testo selezionato</span>
          {!hasSelection && (
            <span className="ml-auto text-xs text-muted-foreground">Seleziona testo</span>
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
