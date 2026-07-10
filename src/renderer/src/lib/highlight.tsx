import { type FC } from 'react'

interface HighlightedTextProps {
  text: string
  query?: string
}

/**
 * Escapes special regex characters in a string.
 */
const escapeRegex = (str: string): string => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Highlights query terms in text by wrapping matches in <mark> elements.
 * Terms shorter than 3 characters are ignored to avoid noisy highlights.
 */
export const HighlightedText: FC<HighlightedTextProps> = ({ text, query }) => {
  if (!query || query.trim().length === 0) {
    return <>{text}</>
  }

  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 2)

  if (terms.length === 0) {
    return <>{text}</>
  }

  const pattern = new RegExp(`(${terms.map(escapeRegex).join('|')})`, 'gi')
  const parts = text.split(pattern)

  return (
    <>
      {parts.map((part, i) => {
        const isMatch = terms.some((term) => part.toLowerCase() === term.toLowerCase())
        return isMatch ? (
          <mark key={i} className="bg-yellow-200 dark:bg-yellow-800/50 rounded-sm px-0.5">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      })}
    </>
  )
}
