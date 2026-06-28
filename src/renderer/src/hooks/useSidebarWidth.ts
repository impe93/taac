import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { SIDEBAR_WIDTH_PX } from '@renderer/components/ui/sidebar'

/**
 * Persists the folder-structure sidebar width (in pixels) to electron-store.
 * Mirrors the pattern used by `useAIChatPanel` for `aiChatPanelSize`.
 */
export function useSidebarWidth(): {
  width: number
  setWidth: (width: number) => void
  isLoading: boolean
} {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery<number>({
    queryKey: ['config', 'sidebarWidth'],
    queryFn: async () => {
      const width = await window.config.get('sidebarWidth')
      return width ?? SIDEBAR_WIDTH_PX
    },
    staleTime: Infinity
  })

  const setWidthMutation = useMutation({
    mutationFn: async (width: number) => {
      await window.config.set('sidebarWidth', width)
      return width
    },
    onSuccess: (width) => {
      queryClient.setQueryData(['config', 'sidebarWidth'], width)
    }
  })

  const setWidth = useCallback(
    (width: number) => {
      setWidthMutation.mutate(width)
    },
    [setWidthMutation]
  )

  return {
    width: data ?? SIDEBAR_WIDTH_PX,
    setWidth,
    isLoading
  }
}
