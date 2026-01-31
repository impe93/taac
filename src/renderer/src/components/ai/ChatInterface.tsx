import { type FC, useState, useRef, useEffect, useCallback } from 'react'
import { Bot, Loader2, MessageSquare } from 'lucide-react'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { Badge } from '@renderer/components/ui/badge'
import { cn } from '@renderer/lib/utils'
import { ChatMessage } from './ChatMessage'
import { ChatInput } from './ChatInput'
import { ChatContextNotes, searchResultToContextNote, type ContextNote } from './ChatContextNotes'
import { useAIChat, useLoadedModels } from '@renderer/hooks/useAI'
import { useVectorSearch } from '@renderer/hooks/useVectorSearch'
import type { ChatMessage as ChatMessageType, NoteReference } from '@main/ai/types'

interface ChatInterfaceProps {
  modelId: string
  initialMessages?: ChatMessageType[]
  systemPrompt?: string
  spaceId?: string
  enableRAG?: boolean
  ragSearchLimit?: number
  onNoteClick?: (noteId: string) => void
  className?: string
}

const generateMessageId = (): string =>
  `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

const LoadingSkeleton: FC = () => (
  <div className="flex flex-col h-full">
    {/* Header skeleton */}
    <div className="flex items-center justify-between px-4 py-3 border-b">
      <div className="flex items-center gap-2">
        <Skeleton className="size-8 rounded-full" />
        <div className="space-y-1">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>
      <Skeleton className="h-5 w-20" />
    </div>

    {/* Messages skeleton */}
    <div className="flex-1 p-4 space-y-4">
      <div className="flex gap-3">
        <Skeleton className="size-8 rounded-full shrink-0" />
        <div className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-16 w-64 rounded-2xl" />
        </div>
      </div>
      <div className="flex gap-3 flex-row-reverse">
        <Skeleton className="size-8 rounded-full shrink-0" />
        <div className="space-y-2 flex flex-col items-end">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-10 w-48 rounded-2xl" />
        </div>
      </div>
      <div className="flex gap-3">
        <Skeleton className="size-8 rounded-full shrink-0" />
        <div className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-24 w-72 rounded-2xl" />
        </div>
      </div>
    </div>

    {/* Input skeleton */}
    <div className="p-4 border-t">
      <div className="flex items-end gap-2">
        <Skeleton className="h-10 flex-1" />
        <Skeleton className="size-9" />
      </div>
    </div>
  </div>
)

const EmptyState: FC = () => (
  <div className="flex flex-col items-center justify-center h-full text-center px-4">
    <div className="rounded-full bg-muted p-4 mb-4">
      <MessageSquare className="size-8 text-muted-foreground" />
    </div>
    <h3 className="text-lg font-medium mb-2">Start a conversation</h3>
    <p className="text-sm text-muted-foreground max-w-sm">
      Type a message below to begin chatting with the AI assistant.
    </p>
  </div>
)

const DEFAULT_RAG_SEARCH_LIMIT = 5
const RAG_RELEVANCE_THRESHOLD = 40 // Minimum relevance score to include in context

/**
 * Builds a context prompt from relevant notes
 */
const buildContextPrompt = (notes: ContextNote[], userMessage: string): string => {
  if (notes.length === 0) return userMessage

  const notesContext = notes
    .map(
      (note, i) =>
        `[Note ${i + 1}: "${note.title}" (${note.relevanceScore}% relevant)]\n${note.excerpt}`
    )
    .join('\n\n')

  return `Given the following notes as context:

${notesContext}

User question: ${userMessage}`
}

/**
 * Converts ContextNote array to NoteReference array for message storage
 */
const contextNotesToReferences = (notes: ContextNote[], spaceId: string): NoteReference[] =>
  notes.map((note) => ({
    noteId: note.noteId,
    spaceId,
    title: note.title,
    excerpt: note.excerpt,
    relevanceScore: note.relevanceScore
  }))

export const ChatInterface: FC<ChatInterfaceProps> = ({
  modelId,
  initialMessages = [],
  systemPrompt,
  spaceId,
  enableRAG = false,
  ragSearchLimit = DEFAULT_RAG_SEARCH_LIMIT,
  onNoteClick,
  className
}) => {
  const [messages, setMessages] = useState<ChatMessageType[]>(initialMessages)
  const [contextNotes, setContextNotes] = useState<ContextNote[]>([])
  const [isSearchingContext, setIsSearchingContext] = useState(false)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // AI hooks
  const { sendMessage, isGenerating, currentResponse } = useAIChat(modelId)
  const { loadedModels, isLoadingModels } = useLoadedModels()

  // Vector search hook - only used when RAG is enabled
  const vectorSearch = useVectorSearch(spaceId || '')
  const isRAGEnabled = enableRAG && !!spaceId

  // Check if the model is loaded
  const loadedModel = loadedModels.find((m) => m.id === modelId)
  const isModelLoaded = Boolean(loadedModel)

  // Auto-scroll to bottom when messages change or during streaming
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, currentResponse, scrollToBottom])

  /**
   * Searches for relevant notes and updates context state
   */
  const searchRelevantNotes = async (query: string): Promise<ContextNote[]> => {
    if (!isRAGEnabled) return []

    setIsSearchingContext(true)
    try {
      const results = await vectorSearch.mutateAsync({
        query,
        limit: ragSearchLimit
      })

      // Transform results and filter by relevance threshold
      const notes = results
        .map(searchResultToContextNote)
        .filter((note) => note.relevanceScore >= RAG_RELEVANCE_THRESHOLD)

      setContextNotes(notes)
      return notes
    } catch (error) {
      console.error('Error searching for relevant notes:', error)
      return []
    } finally {
      setIsSearchingContext(false)
    }
  }

  /**
   * Removes a note from the context
   */
  const handleRemoveContextNote = (noteId: string): void => {
    setContextNotes((prev) => prev.filter((note) => note.noteId !== noteId))
  }

  const handleSend = async (content: string): Promise<void> => {
    // Search for relevant notes if RAG is enabled
    let relevantNotes = contextNotes
    if (isRAGEnabled && contextNotes.length === 0) {
      relevantNotes = await searchRelevantNotes(content)
    }

    // Build content with context if RAG is enabled
    const messageContentForAPI = isRAGEnabled ? buildContextPrompt(relevantNotes, content) : content

    // Create user message (store original content, not the augmented one)
    const userMessage: ChatMessageType = {
      id: generateMessageId(),
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
      // Store note references in the message
      noteReferences:
        isRAGEnabled && spaceId ? contextNotesToReferences(relevantNotes, spaceId) : undefined
    }

    // Add user message to state
    setMessages((prev) => [...prev, userMessage])

    // Clear context notes after sending (will search fresh for next message)
    setContextNotes([])

    // Build messages array for API
    const apiMessages = [
      ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: messageContentForAPI }
    ]

    try {
      // Send to AI and wait for response
      const response = await sendMessage(apiMessages)

      // Create assistant message
      const assistantMessage: ChatMessageType = {
        id: generateMessageId(),
        role: 'assistant',
        content: response,
        timestamp: new Date().toISOString()
      }

      // Add assistant message to state
      setMessages((prev) => [...prev, assistantMessage])
    } catch (error) {
      // Create error message
      const errorMessage: ChatMessageType = {
        id: generateMessageId(),
        role: 'assistant',
        content: 'Sorry, an error occurred while generating a response. Please try again.',
        timestamp: new Date().toISOString()
      }
      setMessages((prev) => [...prev, errorMessage])
      console.error('Chat error:', error)
    }
  }

  // Show loading skeleton while checking model status
  if (isLoadingModels) {
    return (
      <div className={cn('flex flex-col h-full bg-background', className)}>
        <LoadingSkeleton />
      </div>
    )
  }

  // Create streaming message for display
  const streamingMessage: ChatMessageType | null =
    isGenerating && currentResponse
      ? {
          id: 'streaming',
          role: 'assistant',
          content: currentResponse,
          timestamp: new Date().toISOString()
        }
      : null

  // All messages to display (including streaming)
  const displayMessages = streamingMessage ? [...messages, streamingMessage] : messages

  return (
    <div className={cn('flex flex-col h-full bg-background', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center size-8 rounded-full bg-muted">
            <Bot className="size-4 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-sm font-medium">{modelId}</h2>
            <p className="text-xs text-muted-foreground">AI Assistant</p>
          </div>
        </div>
        <Badge variant={isModelLoaded ? 'default' : 'secondary'} className="gap-1.5">
          {isModelLoaded ? (
            'Ready'
          ) : (
            <>
              <Loader2 className="size-3 animate-spin" />
              Loading
            </>
          )}
        </Badge>
      </div>

      {/* Messages */}
      <ScrollArea ref={scrollAreaRef} className="flex-1">
        {displayMessages.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="p-4 space-y-4">
            {displayMessages.map((message) => (
              <ChatMessage
                key={message.id}
                message={message}
                isStreaming={message.id === 'streaming'}
              />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>

      {/* Input area with optional context notes */}
      <div className="p-4 border-t shrink-0 space-y-3">
        {/* Show context notes when RAG is enabled */}
        {isRAGEnabled && (contextNotes.length > 0 || isSearchingContext) && (
          <ChatContextNotes
            notes={contextNotes}
            onRemove={handleRemoveContextNote}
            onNoteClick={onNoteClick}
            isLoading={isSearchingContext}
          />
        )}

        <ChatInput
          onSend={handleSend}
          isDisabled={!isModelLoaded || isSearchingContext}
          isLoading={isGenerating}
          placeholder={
            isSearchingContext
              ? 'Searching for relevant notes...'
              : isModelLoaded
                ? isRAGEnabled
                  ? 'Ask a question about your notes...'
                  : 'Type a message...'
                : 'Waiting for model to load...'
          }
        />
      </div>
    </div>
  )
}
