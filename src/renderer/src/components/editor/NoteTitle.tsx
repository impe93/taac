import { type FC, useState, useCallback, useEffect, type ChangeEvent, type KeyboardEvent } from 'react'
import { cn } from '@renderer/lib/utils'

interface NoteTitleProps {
  title: string
  onChange: (title: string) => void
  className?: string
  placeholder?: string
}

export const NoteTitle: FC<NoteTitleProps> = ({
  title,
  onChange,
  className,
  placeholder = 'Untitled'
}) => {
  const [localTitle, setLocalTitle] = useState(title)

  // Sync with external changes
  useEffect(() => {
    setLocalTitle(title)
  }, [title])

  const handleChange = useCallback((e: ChangeEvent<HTMLInputElement>): void => {
    setLocalTitle(e.target.value)
  }, [])

  const handleBlur = useCallback((): void => {
    if (localTitle !== title) {
      onChange(localTitle)
    }
  }, [localTitle, title, onChange])

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.currentTarget.blur()
    }
  }, [])

  return (
    <input
      type="text"
      value={localTitle}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      className={cn(
        'w-full bg-transparent border-none outline-none',
        'text-2xl font-semibold',
        'text-foreground placeholder:text-muted-foreground',
        'focus:outline-none focus:ring-0',
        className
      )}
    />
  )
}
