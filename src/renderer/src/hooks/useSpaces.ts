import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { Space } from '@preload/types'
import { useAppDispatch, useAppStore } from '@renderer/store/hooks'
import { switchActiveSpace, loadTree } from '@renderer/store/slices/notesTreeSlice'

// List all spaces
export const useSpaces = () => {
  return useQuery({
    queryKey: ['spaces'],
    queryFn: () => window.space.list(),
    staleTime: Infinity
  })
}

// Get a single space by ID
export const useSpace = (spaceId: string | null) => {
  return useQuery({
    queryKey: ['space', spaceId],
    queryFn: () => window.space.get(spaceId!),
    enabled: !!spaceId,
    staleTime: Infinity
  })
}

// Get active space (combines activeSpaceId from config + space data)
export const useActiveSpace = () => {
  const queryClient = useQueryClient()

  const { data: activeSpaceId } = useQuery({
    queryKey: ['config', 'activeSpaceId'],
    queryFn: () => window.config.get('activeSpaceId'),
    staleTime: Infinity
  })

  useEffect(() => {
    const unsubscribe = window.config.onChange('activeSpaceId', (newValue) => {
      queryClient.setQueryData(['config', 'activeSpaceId'], newValue)
    })
    return unsubscribe
  }, [queryClient])

  const { data: spaces } = useSpaces()

  if (!activeSpaceId || !spaces) {
    return null
  }

  return spaces.find((s) => s.id === activeSpaceId) || null
}

// Create a new space
export const useCreateSpace = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ name, icon }: { name: string; icon: string }) => window.space.create(name, icon),
    onSuccess: (newSpace) => {
      queryClient.invalidateQueries({ queryKey: ['spaces'] })
      queryClient.setQueryData(['space', newSpace.id], newSpace)
    }
  })
}

// Update space metadata
export const useUpdateSpace = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ spaceId, updates }: { spaceId: string; updates: Partial<Space> }) =>
      window.space.update(spaceId, updates),
    onSuccess: (updatedSpace) => {
      queryClient.invalidateQueries({ queryKey: ['spaces'] })
      queryClient.setQueryData(['space', updatedSpace.id], updatedSpace)
    }
  })
}

// Delete a space
export const useDeleteSpace = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (spaceId: string) => window.space.delete(spaceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['spaces'] })
      queryClient.invalidateQueries({ queryKey: ['config', 'activeSpaceId'] })
      queryClient.invalidateQueries({ queryKey: ['folderTree'] })
      queryClient.invalidateQueries({ queryKey: ['notes'] })
    }
  })
}

// Switch active space
export const useSwitchSpace = () => {
  const queryClient = useQueryClient()
  const dispatch = useAppDispatch()
  const store = useAppStore()

  return useMutation({
    mutationFn: async (spaceId: string) => {
      // 1. Update electron-store config
      await window.config.set('activeSpaceId', spaceId)

      // 2. Update Redux active space
      dispatch(switchActiveSpace(spaceId))

      // 3. Se spazio non è fully hydrated, carica da filesystem
      const state = store.getState()
      const space = state.notesTree.spaces[spaceId]
      if (!space?.isFullyHydrated) {
        dispatch(loadTree({ spaceId }))
      }

      return spaceId
    },
    onSuccess: (spaceId) => {
      // 4. Update React Query cache
      queryClient.setQueryData(['config', 'activeSpaceId'], spaceId)
      // Note: Non invalidiamo più le query perché Redux gestisce lo stato
    }
  })
}
