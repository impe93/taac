import { type FC, type KeyboardEvent, useState, useRef, useEffect } from 'react'
import { Send, Loader2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Textarea } from '@renderer/components/ui/textarea'
import { cn } from '@renderer/lib/utils'

interface ChatInputProps {
  onSend: (message: string) => void
  isDisabled?: boolean
  isLoading?: boolean
  placeholder?: string
  className?: string
}

export const ChatInput: FC<ChatInputProps> = ({
  onSend,
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
      <Button
        onClick={handleSend}
        disabled={!canSend}
        size="icon"
        className="shrink-0"
        aria-label="Send message"
      >
        {isLoading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
      </Button>
    </div>
  )
}
