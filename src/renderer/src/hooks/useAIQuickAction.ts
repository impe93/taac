import { useCallback } from 'react'
import { useQueryClient, useQuery, useMutation } from '@tanstack/react-query'
import { useAIChatPanel } from './useAIChatPanel'
import type { NoteReference } from '@main/ai/types'

/**
 * Types of quick AI actions available from the note editor
 */
export type AIQuickActionType = 'ask' | 'summarize' | 'explain'

/**
 * A pending quick action to be processed by the AI panel
 */
export interface AIQuickAction {
  type: AIQuickActionType
  noteRef: NoteReference
  selectedText?: string
  timestamp: number
}

/**
 * Input for triggering a quick action
 */
export type TriggerActionInput = Omit<AIQuickAction, 'timestamp'>

const QUERY_KEY = ['ai', 'quickAction'] as const

/**
 * Hook for managing AI quick actions from the note editor.
 *
 * This hook provides a way to communicate between the note editor and the AI panel.
 * When a quick action is triggered, the AI panel listens for it and processes accordingly.
 *
 * @example
 * ```tsx
 * // In note editor:
 * const { triggerAction } = useAIQuickAction()
 * triggerAction({ type: 'summarize', noteRef: { noteId, spaceId, title, excerpt } })
 *
 * // In AI panel:
 * const { pendingAction, clearAction } = useAIQuickAction()
 * useEffect(() => {
 *   if (pendingAction) {
 *     // Process action...
 *     clearAction()
 *   }
 * }, [pendingAction])
 * ```
 */
export function useAIQuickAction(): {
  pendingAction: AIQuickAction | null
  triggerAction: (input: TriggerActionInput) => void
  clearAction: () => void
  isProcessing: boolean
} {
  const queryClient = useQueryClient()
  const { open: openAIPanel } = useAIChatPanel()

  // Read pending action from query cache
  const { data: pendingAction } = useQuery<AIQuickAction | null>({
    queryKey: QUERY_KEY,
    queryFn: () => null,
    staleTime: Infinity,
    initialData: null
  })

  // Mutation to set the pending action
  const triggerMutation = useMutation({
    mutationFn: async (input: TriggerActionInput) => {
      const action: AIQuickAction = {
        ...input,
        timestamp: Date.now()
      }
      return action
    },
    onSuccess: (action) => {
      queryClient.setQueryData<AIQuickAction | null>(QUERY_KEY, action)
      // Open the AI panel when action is triggered
      openAIPanel()
    }
  })

  // Mutation to clear the pending action
  const clearMutation = useMutation({
    mutationFn: async () => null,
    onSuccess: () => {
      queryClient.setQueryData<AIQuickAction | null>(QUERY_KEY, null)
    }
  })

  const triggerAction = useCallback(
    (input: TriggerActionInput) => {
      triggerMutation.mutate(input)
    },
    [triggerMutation]
  )

  const clearAction = useCallback(() => {
    clearMutation.mutate()
  }, [clearMutation])

  return {
    pendingAction: pendingAction ?? null,
    triggerAction,
    clearAction,
    isProcessing: triggerMutation.isPending
  }
}
