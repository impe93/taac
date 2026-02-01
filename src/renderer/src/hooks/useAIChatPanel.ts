import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect } from 'react'

interface AIChatPanelState {
  isOpen: boolean
  panelSize: number
}

export function useAIChatPanel(): {
  isOpen: boolean
  panelSize: number
  toggle: () => void
  open: () => void
  close: () => void
  setPanelSize: (size: number) => void
  isLoading: boolean
} {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery<AIChatPanelState>({
    queryKey: ['config', 'aiChatPanel'],
    queryFn: async () => {
      const isOpen = await window.config.get('aiChatPanelOpen')
      const panelSize = await window.config.get('aiChatPanelSize')
      return {
        isOpen: isOpen ?? false,
        panelSize: panelSize ?? 35
      }
    },
    staleTime: Infinity
  })

  const setOpenMutation = useMutation({
    mutationFn: async (isOpen: boolean) => {
      await window.config.set('aiChatPanelOpen', isOpen)
      return isOpen
    },
    onSuccess: (isOpen) => {
      queryClient.setQueryData(['config', 'aiChatPanel'], (prev: AIChatPanelState | undefined) => ({
        isOpen,
        panelSize: prev?.panelSize ?? 35
      }))
    }
  })

  const setSizeMutation = useMutation({
    mutationFn: async (size: number) => {
      await window.config.set('aiChatPanelSize', size)
      return size
    },
    onSuccess: (size) => {
      queryClient.setQueryData(['config', 'aiChatPanel'], (prev: AIChatPanelState | undefined) => ({
        isOpen: prev?.isOpen ?? false,
        panelSize: size
      }))
    }
  })

  const toggle = useCallback(() => {
    setOpenMutation.mutate(!data?.isOpen)
  }, [data?.isOpen, setOpenMutation])

  const open = useCallback(() => {
    setOpenMutation.mutate(true)
  }, [setOpenMutation])

  const close = useCallback(() => {
    setOpenMutation.mutate(false)
  }, [setOpenMutation])

  const setPanelSize = useCallback(
    (size: number) => {
      setSizeMutation.mutate(size)
    },
    [setSizeMutation]
  )

  // Keyboard shortcut: Cmd/Ctrl + Shift + A
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        toggle()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toggle])

  return {
    isOpen: data?.isOpen ?? false,
    panelSize: data?.panelSize ?? 35,
    toggle,
    open,
    close,
    setPanelSize,
    isLoading
  }
}
