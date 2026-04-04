import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Conversation, ConversationSummary, NoteReference, ChatMessage } from '@main/ai/types'

// Query keys
export const conversationKeys = {
  all: ['ai', 'conversations'] as const,
  detail: (id: string) => ['ai', 'conversation', id] as const
}

// List all conversations
export const useConversations = (): ReturnType<typeof useQuery<ConversationSummary[], Error>> => {
  return useQuery({
    queryKey: conversationKeys.all,
    queryFn: () => window.ai.listConversations()
  })
}

// Get a single conversation by ID
export const useConversation = (
  id: string | null | undefined
): ReturnType<typeof useQuery<Conversation, Error>> => {
  return useQuery({
    queryKey: conversationKeys.detail(id!),
    queryFn: () => window.ai.getConversation(id!),
    enabled: !!id
  })
}

// Create a new conversation
export const useCreateConversation = (): ReturnType<
  typeof useMutation<Conversation, Error, { title: string; modelId: string; systemPrompt?: string }>
> => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      title,
      modelId,
      systemPrompt
    }: {
      title: string
      modelId: string
      systemPrompt?: string
    }) => window.ai.createConversation(title, modelId, systemPrompt),
    onSuccess: (newConversation) => {
      queryClient.invalidateQueries({ queryKey: conversationKeys.all })
      queryClient.setQueryData(conversationKeys.detail(newConversation.id), newConversation)
    }
  })
}

// Remove the last message from a conversation (used when generation is aborted)
export const useRemoveLastMessage = (): ReturnType<typeof useMutation<void, Error, string>> => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (conversationId: string) => window.ai.removeLastMessage(conversationId),
    onSuccess: (_, conversationId) => {
      queryClient.invalidateQueries({ queryKey: conversationKeys.detail(conversationId) })
    }
  })
}

// Add a message to a conversation
export const useAddMessage = (): ReturnType<
  typeof useMutation<
    ChatMessage,
    Error,
    {
      conversationId: string
      role: 'user' | 'assistant'
      content: string
      noteRefs?: NoteReference[]
    }
  >
> => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      conversationId,
      role,
      content,
      noteRefs
    }: {
      conversationId: string
      role: 'user' | 'assistant'
      content: string
      noteRefs?: NoteReference[]
    }) => window.ai.addMessage(conversationId, role, content, noteRefs),
    onSuccess: (_, { conversationId }) => {
      queryClient.invalidateQueries({
        queryKey: conversationKeys.detail(conversationId)
      })
    }
  })
}

// Update conversation title
export const useUpdateConversationTitle = (): ReturnType<
  typeof useMutation<Conversation, Error, { conversationId: string; title: string }>
> => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ conversationId, title }: { conversationId: string; title: string }) =>
      window.ai.updateConversationTitle(conversationId, title),
    onSuccess: (updatedConversation) => {
      queryClient.invalidateQueries({ queryKey: conversationKeys.all })
      queryClient.setQueryData(conversationKeys.detail(updatedConversation.id), updatedConversation)
    }
  })
}

// Delete a conversation
export const useDeleteConversation = (): ReturnType<typeof useMutation<void, Error, string>> => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (conversationId: string) => window.ai.deleteConversation(conversationId),
    onSuccess: (_, conversationId) => {
      queryClient.invalidateQueries({ queryKey: conversationKeys.all })
      queryClient.removeQueries({ queryKey: conversationKeys.detail(conversationId) })
    }
  })
}

// Add a note reference to a conversation
export const useAddNoteToConversation = (): ReturnType<
  typeof useMutation<Conversation, Error, { conversationId: string; noteRef: NoteReference }>
> => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ conversationId, noteRef }: { conversationId: string; noteRef: NoteReference }) =>
      window.ai.addNoteToConversation(conversationId, noteRef),
    onSuccess: (updatedConversation) => {
      queryClient.setQueryData(conversationKeys.detail(updatedConversation.id), updatedConversation)
    }
  })
}

// Remove a note reference from a conversation
export const useRemoveNoteFromConversation = (): ReturnType<
  typeof useMutation<Conversation, Error, { conversationId: string; noteId: string }>
> => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ conversationId, noteId }: { conversationId: string; noteId: string }) =>
      window.ai.removeNoteFromConversation(conversationId, noteId),
    onSuccess: (updatedConversation) => {
      queryClient.setQueryData(conversationKeys.detail(updatedConversation.id), updatedConversation)
    }
  })
}
