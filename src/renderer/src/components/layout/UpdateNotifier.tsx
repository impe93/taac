import { useEffect, useRef, type FC } from 'react'
import { toast } from 'sonner'
import { useUpdater } from '@renderer/hooks/useUpdater'

/**
 * Headless listener: surfaces a persistent toast once an update has finished
 * downloading in the background, offering an immediate restart. Mounted once in
 * the provider tree so it lives for the whole session.
 */
export const UpdateNotifier: FC = () => {
  const { state, install } = useUpdater()
  // Guards against re-toasting the same version on every state broadcast.
  const notifiedVersion = useRef<string | null>(null)

  useEffect(() => {
    if (state.status !== 'downloaded') return
    const version = state.version ?? 'unknown'
    if (notifiedVersion.current === version) return
    notifiedVersion.current = version

    toast.success(`Version ${version} is ready to install`, {
      description: 'Taac will restart to finish the update.',
      duration: Infinity,
      action: {
        label: 'Restart now',
        onClick: () => {
          void install()
        }
      }
    })
  }, [state.status, state.version, install])

  return null
}
