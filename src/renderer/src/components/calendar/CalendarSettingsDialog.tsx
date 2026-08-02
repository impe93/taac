import { type FC } from 'react'
import { toast } from 'sonner'
import { Calendar, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import type { CalendarProviderId } from '@preload/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { Switch } from '@renderer/components/ui/switch'
import { Badge } from '@renderer/components/ui/badge'
import { Separator } from '@renderer/components/ui/separator'
import {
  useCalendarAccounts,
  useConfiguredProviders,
  useLinkCalendarAccount,
  useSetCalendarEnabled,
  useSyncCalendars,
  useUnlinkCalendarAccount
} from '@renderer/hooks/useCalendar'

interface CalendarSettingsDialogProps {
  spaceId: string
  spaceName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

const PROVIDER_LABEL: Record<CalendarProviderId, string> = {
  google: 'Google',
  microsoft: 'Microsoft'
}

export const CalendarSettingsDialog: FC<CalendarSettingsDialogProps> = ({
  spaceId,
  spaceName,
  open,
  onOpenChange
}) => {
  const { data: providers = [] } = useConfiguredProviders()
  const { data: accounts = [], isLoading } = useCalendarAccounts(open ? spaceId : null)
  const linkMutation = useLinkCalendarAccount(spaceId)
  const unlinkMutation = useUnlinkCalendarAccount(spaceId)
  const setEnabled = useSetCalendarEnabled(spaceId)
  const syncNow = useSyncCalendars(spaceId)

  const handleConnect = (provider: CalendarProviderId): void => {
    linkMutation.mutate(provider, {
      onSuccess: (account) => toast.success(`Connected ${account.email}`),
      onError: (error) => toast.error((error as Error).message)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="size-5" />
            Calendar accounts
          </DialogTitle>
          <DialogDescription>
            Connect calendars to <span className="font-medium">{spaceName}</span>. Meetings from
            enabled calendars notify you at their start time and create a linked meeting note.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {providers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No calendar providers are configured in this build.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {providers.map((provider) => (
                <Button
                  key={provider}
                  variant="outline"
                  size="sm"
                  disabled={linkMutation.isPending}
                  onClick={() => handleConnect(provider)}
                >
                  {linkMutation.isPending && linkMutation.variables === provider ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  Connect {PROVIDER_LABEL[provider]}
                </Button>
              ))}
            </div>
          )}

          <Separator />

          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No calendars connected yet.</p>
          ) : (
            <div className="flex flex-col gap-4 max-h-[45vh] overflow-y-auto">
              {accounts.map((account) => (
                <div key={account.id} className="rounded-lg border p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{PROVIDER_LABEL[account.provider]}</Badge>
                        <span className="truncate text-sm font-medium">{account.email}</span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-destructive"
                      disabled={unlinkMutation.isPending}
                      onClick={() =>
                        unlinkMutation.mutate(account.id, {
                          onSuccess: () => toast.success('Disconnected'),
                          onError: (error) => toast.error((error as Error).message)
                        })
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>

                  <div className="flex flex-col divide-y">
                    {account.calendars.map((calendar) => (
                      <div
                        key={calendar.id}
                        className="flex items-center justify-between gap-2 py-2"
                      >
                        <span className="truncate text-sm">{calendar.name}</span>
                        <Switch
                          checked={calendar.enabled}
                          onCheckedChange={(enabled) =>
                            setEnabled.mutate({
                              accountId: account.id,
                              calendarId: calendar.id,
                              enabled
                            })
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {accounts.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="self-start text-muted-foreground"
              disabled={syncNow.isPending}
              onClick={() => syncNow.mutate()}
            >
              <RefreshCw className={syncNow.isPending ? 'size-4 animate-spin' : 'size-4'} />
              Sync now
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
