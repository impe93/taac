import { type FC, type KeyboardEvent, useState, useRef, useEffect } from 'react'
import { Send, Square } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Textarea } from '@renderer/components/ui/textarea'
import { cn } from '@renderer/lib/utils'

interface ChatInputProps {
  onSend: (message: string) => void
  onStop?: () => void
  restoredValue?: string
  isDisabled?: boolean
  isLoading?: boolean
  placeholder?: string
  className?: string
}

export const ChatInput: FC<ChatInputProps> = ({
  onSend,
  onStop,
  restoredValue,
  isDisabled = false,
  isLoading = false,
  placeholder = 'Type a message...',
  className
}) => {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const canSend = value.trim().length > 0 && !isDisabled && !isLoading

  const handleSend = (): void => {
    if (!canSend) return

    const message = value.trim()
    setValue('')
    onSend(message)

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    // Send on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  // Restore value when generation is aborted
  useEffect(() => {
    if (restoredValue !== undefined && restoredValue !== '') {
      setValue(restoredValue)
      // Focus and move cursor to end
      if (textareaRef.current) {
        textareaRef.current.focus()
      }
    }
  }, [restoredValue])

  return (
    <div className={cn('flex items-end gap-2', className)}>
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={isDisabled || isLoading}
        className="min-h-10 max-h-40 resize-none"
        rows={1}
      />
      {isLoading ? (
        <Button
          onClick={onStop}
          size="icon"
          variant="destructive"
          className="shrink-0"
          aria-label="Stop generation"
        >
          <Square className="size-4" />
        </Button>
      ) : (
        <Button
          onClick={handleSend}
          disabled={!canSend}
          size="icon"
          className="shrink-0"
          aria-label="Send message"
        >
          <Send className="size-4" />
        </Button>
      )}
    </div>
  )
}
