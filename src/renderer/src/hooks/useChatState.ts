import { useState, useCallback, useMemo } from 'react'
import { useConversation, useAddMessage } from './useConversations'
import type { ChatMessage, NoteReference, Conversation } from '@main/ai/types'

/**
 * Generates a unique message ID
 */
const generateMessageId = (): string =>
  `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

interface UseChatStateOptions {
  conversationId?: string
  initialMessages?: ChatMessage[]
}

interface ChatStateReturn {
  /** All messages in the conversation */
  messages: ChatMessage[]
  /** Add a message to the conversation */
  addMessage: (
    role: 'user' | 'assistant',
    content: string,
    noteRefs?: NoteReference[]
  ) => Promise<ChatMessage>
  /** Whether messages are being loaded from a conversation */
  isLoadingMessages: boolean
  /** The loaded conversation (if using persistent mode) */
  conversation: Conversation | undefined
  /** Whether we're in persistent mode */
  isPersistent: boolean
  /** Error loading the conversation */
  error: Error | null
}

/**
 * Hook that manages chat state for both persistent and standalone modes.
 *
 * - If `conversationId` is provided, messages are loaded from and persisted to the database
 * - If no `conversationId`, messages are stored in local React state
 */
export const useChatState = ({
  conversationId,
  initialMessages = []
}: UseChatStateOptions): ChatStateReturn => {
  // Local state for standalone mode
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>(initialMessages)

  // Query for persistent mode
  const conversationQuery = useConversation(conversationId)
  const addMessageMutation = useAddMessage()

  const isPersistent = Boolean(conversationId)

  // Get messages from either local state or conversation query
  const messages = useMemo(() => {
    if (isPersistent && conversationQuery.data) {
      return conversationQuery.data.messages
    }
    return localMessages
  }, [isPersistent, conversationQuery.data, localMessages])

  // Add message handler - works for both modes
  const addMessage = useCallback(
    async (
      role: 'user' | 'assistant',
      content: string,
      noteRefs?: NoteReference[]
    ): Promise<ChatMessage> => {
      if (isPersistent && conversationId) {
        // Persistent mode: use mutation to save to database
        const savedMessage = await addMessageMutation.mutateAsync({
          conversationId,
          role,
          content,
          noteRefs
        })
        return savedMessage
      } else {
        // Standalone mode: update local state
        const newMessage: ChatMessage = {
          id: generateMessageId(),
          role,
          content,
          timestamp: new Date().toISOString(),
          noteReferences: noteRefs
        }
        setLocalMessages((prev) => [...prev, newMessage])
        return newMessage
      }
    },
    [isPersistent, conversationId, addMessageMutation]
  )

  return {
    messages,
    addMessage,
    isLoadingMessages: isPersistent && conversationQuery.isLoading,
    conversation: conversationQuery.data,
    isPersistent,
    error: conversationQuery.error
  }
}
