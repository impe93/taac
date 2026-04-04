import { type FC, useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Bot, Loader2, MessageSquare, AlertCircle, AlertTriangle } from 'lucide-react'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import { cn } from '@renderer/lib/utils'
import { ChatMessage } from './ChatMessage'
import { ChatInput } from './ChatInput'
import { rankedResultsToContextNotes, type ContextNote } from './ChatContextNotes'
import { ConversationHeader } from './ConversationHeader'
import { useAIChat, useLoadedModels, useAIInitialize } from '@renderer/hooks/useAI'
import { useVectorSearch, useEnsureEmbeddingModel } from '@renderer/hooks/useVectorSearch'
import { useChatState } from '@renderer/hooks/useChatState'
import { useUpdateConversationTitle } from '@renderer/hooks/useConversations'
import type { ChatMessage as ChatMessageType, NoteReference } from '@main/ai/types'
import { useAppSelector } from '@renderer/store/hooks'
import { selectSpaceState } from '@renderer/store/slices/notesTreeSlice'
import type { FolderMetadata } from '@preload/types'

interface ChatInterfaceProps {
  /** Model ID to use for chat */
  modelId: string
  /** Optional conversation ID for persistent mode */
  conversationId?: string
  /** Initial messages for standalone mode (ignored if conversationId is set) */
  initialMessages?: ChatMessageType[]
  /** System prompt (ignored if conversationId is set - uses conversation's systemPrompt) */
  systemPrompt?: string
  /** Space ID for RAG search */
  spaceId?: string
  /** Enable RAG (Retrieval Augmented Generation) */
  enableRAG?: boolean
  /** Number of notes to retrieve for RAG context */
  ragSearchLimit?: number
  /** Callback when a note reference is clicked */
  onNoteClick?: (noteId: string) => void
  /** Callback when conversation is closed (only in persistent mode) */
  onClose?: () => void
  /** Callback when conversation is deleted (only in persistent mode) */
  onDelete?: () => void
  className?: string
}

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

const DEFAULT_SYSTEM_PROMPT = `<assistant_config>
  <role>You are a personal knowledge assistant integrated into a note-taking app.</role>

  <objective>
    Answer the user's questions concisely and directly.
    Focus on giving a useful, accurate response — not on explaining your reasoning process.
    If the user asks for a list, provide a list. If they ask a question, answer it directly.
    Do not mention that you searched notes, retrieved context, or used any system.
  </objective>

  <knowledge_handling>
    You may receive relevant notes from the user's personal knowledge base as background context.
    Treat these notes as your own memory — use the information naturally without referencing the notes explicitly.
    Never say "Note 1 says...", "According to the retrieved context...", or similar.
    Never mention note IDs, note titles, relevance scores, or any system metadata.
    If the information isn't available in your context, simply say you don't know.
  </knowledge_handling>

  <formatting>
    Always respond in Markdown.
    Never use tables — use prose paragraphs or bullet lists instead.
    Keep responses concise. Avoid unnecessary preamble or filler phrases.
    Do not start with "Of course!", "Great question!", or similar openers.
  </formatting>
</assistant_config>`

/**
 * Resolves the full folder path for a note by walking up the folder hierarchy.
 * Returns a slash-separated path like "Work / Projects / AI Research", or null if unresolvable.
 */
const getFolderPath = (
  folderId: string | null,
  folders: Record<string, FolderMetadata>
): string | null => {
  if (!folderId || !folders[folderId]) return null

  const parts: string[] = []
  let current: FolderMetadata | undefined = folders[folderId]

  while (current && current.id !== 'root') {
    parts.unshift(current.name)
    current = current.parentId ? folders[current.parentId] : undefined
  }

  return parts.length > 0 ? parts.join(' / ') : null
}

/**
 * Builds a context prompt from relevant notes using XML structure.
 * Notes are passed as background knowledge — the model is instructed not to reference them explicitly.
 */
const buildContextPrompt = (
  notes: ContextNote[],
  userMessage: string,
  folders: Record<string, FolderMetadata>
): string => {
  if (notes.length === 0) return userMessage

  const notesContext = notes
    .map((note) => {
      const sectionTag = note.sectionHeader ? `\n    <section>${note.sectionHeader}</section>` : ''
      // Prefer pre-computed path from metadata; fall back to Redux-computed path for legacy notes
      const folderPath = note.folderPath ?? getFolderPath(note.folderId, folders)
      const folderPathTag = folderPath ? `\n    <folder_path>${folderPath}</folder_path>` : ''
      return `  <note>
    <title>${note.title}</title>${sectionTag}${folderPathTag}
    <relevance>${note.relevanceScore.toFixed(0)}%</relevance>
    <content>${note.fullContent}</content>
  </note>`
    })
    .join('\n')

  return `<knowledge_base>
${notesContext}
</knowledge_base>

<question>${userMessage}</question>`
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
  conversationId,
  initialMessages = [],
  systemPrompt,
  spaceId,
  enableRAG = false,
  ragSearchLimit = DEFAULT_RAG_SEARCH_LIMIT,
  onNoteClick,
  onClose,
  onDelete,
  className
}) => {
  // Chat state management (persistent or standalone mode)
  const {
    messages,
    addMessage,
    removeLastMessage,
    isLoadingMessages,
    conversation,
    isPersistent,
    error: conversationError
  } = useChatState({
    conversationId,
    initialMessages
  })

  // Local state for context notes and search
  const [contextNotes, setContextNotes] = useState<ContextNote[]>([])
  const [isSearchingContext, setIsSearchingContext] = useState(false)
  const [ragError, setRagError] = useState<string | null>(null)
  const [restoredInput, setRestoredInput] = useState<string>('')
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Get effective model ID and system prompt (from conversation or props)
  const effectiveModelId = conversation?.modelId ?? modelId
  const effectiveSystemPrompt = conversation?.systemPrompt ?? systemPrompt

  // AI hooks
  const { sendMessage, abortGeneration, isGenerating, currentResponse } =
    useAIChat(effectiveModelId)
  const { loadedModels, isLoadingModels } = useLoadedModels()
  const updateTitle = useUpdateConversationTitle()
  const { isInitialized, isCheckingInitialized, initialize, isInitializing, initializeError } =
    useAIInitialize()

  // Auto-initialize AI if not initialized (guard on initializeError to prevent infinite retry loop)
  useEffect(() => {
    if (!isCheckingInitialized && !isInitialized && !isInitializing && !initializeError) {
      initialize()
    }
  }, [isCheckingInitialized, isInitialized, isInitializing, initializeError, initialize])

  // Folder tree from Redux for resolving folder paths in context
  const spaceState = useAppSelector(selectSpaceState(spaceId || ''))
  const folders = spaceState?.folders ?? {}

  // Vector search hook - only used when RAG is enabled
  const vectorSearch = useVectorSearch(spaceId || '')
  const isRAGEnabled = enableRAG && !!spaceId

  // Embedding model status hook for RAG
  const {
    isAvailable: isEmbeddingAvailable,
    isLoading: isCheckingEmbedding,
    modelName: embeddingModelName,
    downloadEmbeddingModel,
    isDownloading: isDownloadingEmbedding,
    downloadProgress: embeddingProgress
  } = useEnsureEmbeddingModel()

  // Merge conversation's noteContext with dynamically found context notes
  const conversationContextNotes = useMemo((): ContextNote[] => {
    if (!conversation?.noteContext || conversation.noteContext.length === 0) {
      return []
    }
    return conversation.noteContext.map((ref) => ({
      noteId: ref.noteId,
      folderId: null, // NoteReference doesn't carry folderId
      title: ref.title,
      excerpt: ref.excerpt,
      fullContent: ref.excerpt, // Pinned notes only have excerpt stored
      sectionHeader: null,
      relevanceScore: ref.relevanceScore ?? 100 // Pinned notes get 100% relevance
    }))
  }, [conversation?.noteContext])

  // All context notes: conversation's pinned notes + dynamically found notes
  const allContextNotes = useMemo(() => {
    // Combine pinned notes from conversation with dynamically searched notes
    // Avoid duplicates by noteId
    const pinnedIds = new Set(conversationContextNotes.map((n) => n.noteId))
    const dynamicNotes = contextNotes.filter((n) => !pinnedIds.has(n.noteId))
    return [...conversationContextNotes, ...dynamicNotes]
  }, [conversationContextNotes, contextNotes])

  // Check if the model is loaded
  const loadedModel = loadedModels.find((m) => m.id === effectiveModelId)
  const isModelLoaded = Boolean(loadedModel)

  // Auto-scroll to bottom when messages change or during streaming
  const scrollToBottom = useCallback(() => {
    // Find the ScrollArea viewport and scroll it directly
    // This prevents scrollIntoView from scrolling parent containers
    const viewport = scrollAreaRef.current?.querySelector('[data-slot="scroll-area-viewport"]')
    if (viewport) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' })
    }
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, currentResponse, scrollToBottom])

  /**
   * Searches for relevant notes and updates context state
   */
  const searchRelevantNotes = async (query: string): Promise<ContextNote[]> => {
    if (!isRAGEnabled) return []

    // Check embedding model availability first
    if (!isEmbeddingAvailable) {
      setRagError(
        `Il modello di embedding "${embeddingModelName}" non è disponibile. Scaricalo per abilitare la ricerca nelle note.`
      )
      return []
    }

    setIsSearchingContext(true)
    setRagError(null)
    try {
      const results = await vectorSearch.mutateAsync({
        query,
        limit: ragSearchLimit
      })

      // Transform results — already filtered and scored by the backend
      const notes = rankedResultsToContextNotes(results)
      setContextNotes(notes)
      return notes
    } catch (error) {
      console.error('[RAG] Error searching for relevant notes:', error)
      const errorMessage =
        error instanceof Error ? error.message : 'Errore nella ricerca delle note'
      setRagError(errorMessage)
      return []
    } finally {
      setIsSearchingContext(false)
    }
  }

  /**
   * Removes a note from the context
   * Note: Currently not used in UI, but kept for potential future features
   */
  // const handleRemoveContextNote = (noteId: string): void => {
  //   setContextNotes((prev) => prev.filter((note) => note.noteId !== noteId))
  // }

  const handleSend = async (content: string): Promise<void> => {
    // Capture before any state mutation to detect first message
    const isFirstMessage = messages.length === 0

    // Always search for relevant notes if RAG is enabled
    let relevantNotes: ContextNote[] = []
    if (isRAGEnabled) {
      const searchedNotes = await searchRelevantNotes(content)
      // Merge: pinned conversation notes + fresh search results, dedup by noteId
      const pinnedIds = new Set(conversationContextNotes.map((n) => n.noteId))
      const freshNotes = searchedNotes.filter((n) => !pinnedIds.has(n.noteId))
      relevantNotes = [...conversationContextNotes, ...freshNotes]
    } else {
      relevantNotes = allContextNotes
    }

    // Build content with context if RAG is enabled and we have context
    const messageContentForAPI =
      isRAGEnabled && relevantNotes.length > 0
        ? buildContextPrompt(relevantNotes, content, folders)
        : content

    // Prepare note references for storage
    const noteRefs =
      isRAGEnabled && spaceId && relevantNotes.length > 0
        ? contextNotesToReferences(relevantNotes, spaceId)
        : undefined

    // Add user message using the unified addMessage function
    await addMessage('user', content)

    // Clear dynamic context notes after sending (will search fresh for next message)
    // Note: conversation's pinned noteContext stays
    setContextNotes([])

    // Build messages array for API
    const resolvedSystemPrompt = effectiveSystemPrompt ?? DEFAULT_SYSTEM_PROMPT
    const apiMessages = [
      { role: 'system' as const, content: resolvedSystemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: messageContentForAPI }
    ]

    console.log('[RAG] LLM prompt content:\n', messageContentForAPI)

    try {
      // Send to AI and wait for response
      const { response, aborted } = await sendMessage(apiMessages)

      // If generation was aborted, remove user message and restore input
      if (aborted) {
        await removeLastMessage()
        setRestoredInput(content)
        return
      }

      // Add assistant message using the unified addMessage function
      await addMessage('assistant', response, noteRefs)

      // Auto-generate title after first exchange in a persistent conversation
      if (
        isPersistent &&
        conversationId &&
        isFirstMessage &&
        conversation?.title === 'New conversation'
      ) {
        void (async (): Promise<void> => {
          try {
            const generatedTitle = await window.ai.generateTitle(
              effectiveModelId,
              content,
              response
            )
            if (generatedTitle && generatedTitle !== 'New conversation') {
              await updateTitle.mutateAsync({ conversationId, title: generatedTitle })
            }
          } catch {
            // Title generation is optional — silently ignore errors
          }
        })()
      }
    } catch (error) {
      // Add error message
      await addMessage(
        'assistant',
        'Sorry, an error occurred while generating a response. Please try again.'
      )
      console.error('Chat error:', error)
    }
  }

  // Show loading skeleton while checking model status, initializing AI, or loading conversation
  if (isLoadingModels || isLoadingMessages || isCheckingInitialized || isInitializing) {
    return (
      <div className={cn('flex flex-col h-full bg-background', className)}>
        <LoadingSkeleton />
      </div>
    )
  }

  // Show error state if conversation failed to load
  if (conversationError) {
    return (
      <div className={cn('flex flex-col h-full bg-background p-4', className)}>
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>
            Failed to load conversation: {conversationError.message}
          </AlertDescription>
        </Alert>
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

  // Handler for closing conversation
  const handleClose = (): void => {
    onClose?.()
  }

  // Handler for deleting conversation
  const handleDelete = (): void => {
    onDelete?.()
  }

  return (
    <div className={cn('flex flex-col h-full overflow-hidden bg-background', className)}>
      {/* Header - show ConversationHeader for persistent mode, simple header for standalone */}
      {isPersistent && conversation ? (
        <ConversationHeader
          conversation={conversation}
          onClose={handleClose}
          onDelete={handleDelete}
          className="shrink-0"
        />
      ) : (
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center size-8 rounded-full bg-muted">
              <Bot className="size-4 text-muted-foreground" />
            </div>
            <div>
              <h2 className="text-sm font-medium">{effectiveModelId}</h2>
              <p className="text-xs text-muted-foreground">AI Assistant</p>
            </div>
          </div>
          <Badge variant={isModelLoaded ? 'default' : 'secondary'} className="gap-1.5">
            {isModelLoaded ? (
              'Ready'
            ) : isGenerating ? (
              <>
                <Loader2 className="size-3 animate-spin" />
                Loading model...
              </>
            ) : (
              'Not loaded'
            )}
          </Badge>
        </div>
      )}

      {/* AI initialization error */}
      {initializeError && (
        <div className="px-4 pt-3 shrink-0">
          <Alert variant="destructive">
            <AlertTriangle className="size-4" />
            <AlertTitle>Inizializzazione AI fallita</AlertTitle>
            <AlertDescription className="flex items-center justify-between gap-4">
              <span className="text-sm">
                {(initializeError as Error)?.message ?? "Errore sconosciuto. Riavvia l'app."}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => initialize()}
                disabled={isInitializing}
                className="shrink-0"
              >
                {isInitializing ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    Caricamento...
                  </>
                ) : (
                  'Riprova'
                )}
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      )}

      {/* Embedding model not available warning - only show when RAG is enabled */}
      {isRAGEnabled && !isEmbeddingAvailable && !isCheckingEmbedding && (
        <div className="px-4 pt-3 shrink-0">
          <Alert>
            <AlertTriangle className="size-4" />
            <AlertTitle>Ricerca nelle note disabilitata</AlertTitle>
            <AlertDescription className="flex items-center justify-between gap-4">
              <span className="text-sm">
                Il modello di embedding <strong>{embeddingModelName}</strong> è necessario per
                cercare nelle tue note. Scaricalo per abilitare il RAG.
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={downloadEmbeddingModel}
                disabled={isDownloadingEmbedding}
                className="shrink-0"
              >
                {isDownloadingEmbedding ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    {embeddingProgress ? `${embeddingProgress.percentage}%` : 'Download...'}
                  </>
                ) : (
                  'Scarica'
                )}
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      )}

      {/* RAG error alert */}
      {ragError && (
        <div className="px-4 pt-3 shrink-0">
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertDescription>{ragError}</AlertDescription>
          </Alert>
        </div>
      )}

      {/* Messages */}
      <ScrollArea ref={scrollAreaRef} className="flex-1 min-h-0">
        {displayMessages.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="p-4 space-y-4">
            {displayMessages.map((message) => (
              <ChatMessage
                key={message.id}
                message={message}
                isStreaming={message.id === 'streaming'}
                onNoteClick={onNoteClick}
              />
            ))}
            {/* Loading indicator: model loading or waiting for first chunk */}
            {isGenerating && !currentResponse && (
              <div className="flex gap-3">
                <div className="flex items-center justify-center size-8 rounded-full bg-muted shrink-0">
                  <Bot className="size-4 text-muted-foreground" />
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  {isModelLoaded ? 'Generating response...' : 'Loading model...'}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>

      {/* Input area */}
      <div className="p-4 border-t shrink-0">
        <ChatInput
          onSend={handleSend}
          onStop={abortGeneration}
          restoredValue={restoredInput}
          isDisabled={isSearchingContext}
          isLoading={isGenerating}
          placeholder={
            isSearchingContext
              ? 'Searching for relevant notes...'
              : isRAGEnabled
                ? 'Ask a question about your notes...'
                : 'Type a message...'
          }
        />
      </div>
    </div>
  )
}
