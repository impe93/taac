import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { AppConfig } from '@preload/types'
import { useEffect } from 'react'

// Hook to get a specific config value
export const useConfig = <K extends keyof AppConfig>(key: K) => {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['config', key],
    queryFn: () => window.config.get(key),
    staleTime: Infinity // Config changes only through mutations
  })

  useEffect(() => {
    window.config.onChange(key, (newValue) => {
      queryClient.setQueryData(['config', key], newValue)
    })
  }, [key, queryClient])

  return query
}

// Hook to get all config values
export const useAllConfig = () => {
  return useQuery({
    queryKey: ['config', 'all'],
    queryFn: () => window.config.getAll(),
    staleTime: Infinity
  })
}

// Hook to set a config value
export const useSetConfig = <K extends keyof AppConfig>() => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ key, value }: { key: K; value: AppConfig[K] }) => window.config.set(key, value),
    onSuccess: (_, variables) => {
      queryClient.setQueryData(['config', variables.key], variables.value)
      queryClient.invalidateQueries({ queryKey: ['config', 'all'] })
    }
  })
}

// Hook to reset config to defaults
export const useResetConfig = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => window.config.reset(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] })
    }
  })
}
