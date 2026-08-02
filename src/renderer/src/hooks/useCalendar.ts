import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CalendarProviderId } from '@preload/types'

/** Hierarchical query keys for the calendar domain. */
export const calendarKeys = {
  providers: ['calendar', 'providers'] as const,
  accounts: (spaceId: string) => ['calendar', 'accounts', spaceId] as const,
  upcoming: (spaceId: string, withinHours: number) =>
    ['calendar', 'upcoming', spaceId, withinHours] as const
}

/** Providers whose OAuth client ID is present in the build (others are gated off). */
export const useConfiguredProviders = () =>
  useQuery({
    queryKey: calendarKeys.providers,
    queryFn: () => window.calendar.configuredProviders(),
    staleTime: Infinity
  })

/** Linked accounts + their calendars for a space. Live-refreshed on change. */
export const useCalendarAccounts = (spaceId: string | null) => {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: calendarKeys.accounts(spaceId ?? ''),
    queryFn: () => window.calendar.listAccounts(spaceId as string),
    enabled: !!spaceId,
    staleTime: 30_000
  })

  useEffect(() => {
    if (!spaceId) return
    return window.calendar.onAccountsChanged((payload) => {
      if (payload.spaceId === spaceId) {
        queryClient.invalidateQueries({ queryKey: calendarKeys.accounts(spaceId) })
      }
    })
  }, [spaceId, queryClient])

  return query
}

/** Upcoming meetings for a space within `withinHours`. Live-refreshed on sync. */
export const useUpcomingMeetings = (spaceId: string | null, withinHours: number) => {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: calendarKeys.upcoming(spaceId ?? '', withinHours),
    queryFn: () => window.calendar.listUpcoming(spaceId as string, withinHours),
    enabled: !!spaceId,
    staleTime: 30_000
  })

  useEffect(() => {
    if (!spaceId) return
    return window.calendar.onUpcomingChanged((payload) => {
      if (payload.spaceId === spaceId) {
        queryClient.invalidateQueries({ queryKey: ['calendar', 'upcoming', spaceId] })
      }
    })
  }, [spaceId, queryClient])

  return query
}

export const useLinkCalendarAccount = (spaceId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (provider: CalendarProviderId) => window.calendar.linkAccount(spaceId, provider),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: calendarKeys.accounts(spaceId) })
      queryClient.invalidateQueries({ queryKey: ['calendar', 'upcoming', spaceId] })
    }
  })
}

export const useUnlinkCalendarAccount = (spaceId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (accountId: string) => window.calendar.unlinkAccount(spaceId, accountId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: calendarKeys.accounts(spaceId) })
      queryClient.invalidateQueries({ queryKey: ['calendar', 'upcoming', spaceId] })
    }
  })
}

export const useSetCalendarEnabled = (spaceId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (args: { accountId: string; calendarId: string; enabled: boolean }) =>
      window.calendar.setCalendarEnabled(spaceId, args.accountId, args.calendarId, args.enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: calendarKeys.accounts(spaceId) })
      queryClient.invalidateQueries({ queryKey: ['calendar', 'upcoming', spaceId] })
    }
  })
}

export const useSyncCalendars = (spaceId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => window.calendar.syncNow(spaceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar', 'upcoming', spaceId] })
    }
  })
}
