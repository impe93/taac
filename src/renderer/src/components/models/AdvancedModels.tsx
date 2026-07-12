import { useState, type FC, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@renderer/components/ui/collapsible'

/**
 * Collapsible container for non-optimal but compatible model variants
 * (more/less powerful). Renders nothing when there are no alternatives to show.
 */
export const AdvancedModels: FC<{ label: string; children: ReactNode }> = ({ label, children }) => {
  const [open, setOpen] = useState(false)
  const items = Array.isArray(children) ? children.filter(Boolean) : children
  if (Array.isArray(items) && items.length === 0) return null

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-2">
      <CollapsibleTrigger className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ChevronDown className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        {open ? `Hide ${label}` : `Show ${label}`}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-2">{items}</CollapsibleContent>
    </Collapsible>
  )
}
