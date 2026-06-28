import { type FC } from 'react'
import { cn } from '@renderer/lib/utils'

interface DropIndicatorProps {
  position: 'top' | 'bottom'
}

/**
 * Thin insertion line shown at the top/bottom edge of a tree row to signal
 * where a dragged item will be dropped when reordering. Must be rendered inside
 * a `relative` row container.
 */
export const DropIndicator: FC<DropIndicatorProps> = ({ position }) => (
  <span
    aria-hidden
    className={cn(
      'pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-primary',
      position === 'top' ? 'top-0' : 'bottom-0'
    )}
  />
)
