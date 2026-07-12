import type { FC, CSSProperties } from 'react'
import { Bot, Search, Settings } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { Button } from '@renderer/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { SidebarTrigger } from '@renderer/components/ui/sidebar'
import { IndexingStatusIndicator } from '@renderer/components/ai/IndexingStatusIndicator'
import { ModelDownloadIndicator } from '@renderer/components/models/ModelDownloadIndicator'
import { WINDOW_TOPBAR_HEIGHT } from './constants'

const TOPBAR_HEIGHT = WINDOW_TOPBAR_HEIGHT
// Horizontal space reserved on macOS for the native traffic-light controls.
const TRAFFIC_LIGHTS_RESERVE = 70

// The bar itself is the window drag region; interactive controls opt out.
const dragStyle: CSSProperties = { WebkitAppRegion: 'drag' } as CSSProperties
const noDragStyle: CSSProperties = { WebkitAppRegion: 'no-drag' } as CSSProperties

interface AppTopBarProps {
  isMacOS: boolean
  /** Minimal variant (onboarding/loading): drag region + traffic-light reserve only. */
  minimal?: boolean
  onOpenSearch?: () => void
  aiOpen?: boolean
  onToggleAI?: () => void
  onOpenSettings?: () => void
}

export const AppTopBar: FC<AppTopBarProps> = ({
  isMacOS,
  minimal = false,
  onOpenSearch,
  aiOpen = false,
  onToggleAI,
  onOpenSettings
}) => {
  if (minimal) {
    return (
      <div
        className="fixed inset-x-0 top-0 z-40 flex items-center justify-end border-b bg-background px-2"
        style={{ ...dragStyle, height: TOPBAR_HEIGHT }}
      >
        {/* Surface background downloads (started in onboarding) right away. */}
        <div style={noDragStyle}>
          <ModelDownloadIndicator />
        </div>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-x-0 top-0 z-40 grid grid-cols-[1fr_minmax(0,42rem)_1fr] items-center gap-2 border-b bg-background px-2"
      style={{ ...dragStyle, height: TOPBAR_HEIGHT }}
    >
      {/* Left: traffic-light reserve (macOS) + sidebar trigger + settings */}
      <div
        className="flex items-center gap-1 md:justify-end"
        style={{ paddingLeft: isMacOS ? TRAFFIC_LIGHTS_RESERVE : 0 }}
      >
        <div style={noDragStyle}>
          <SidebarTrigger className="size-7" />
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              style={noDragStyle}
              onClick={onOpenSettings}
            >
              <Settings className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>Settings</p>
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Center: global search trigger */}
      <button
        type="button"
        onClick={onOpenSearch}
        aria-label="Search notes"
        style={noDragStyle}
        className="hidden h-7 w-full max-w-2xl items-center gap-2 rounded-md border bg-background/40 px-3 text-sm text-muted-foreground transition-colors hover:bg-accent md:flex"
      >
        <Search className="size-4 shrink-0" />
        <span className="flex-1 text-left">Search notes…</span>
        <kbd className="pointer-events-none inline-flex h-5 select-none items-center rounded border bg-muted px-1.5 font-mono text-[10px] font-medium">
          ⌘K
        </kbd>
      </button>

      {/* Right: AI panel toggle (nearest search, mirrors Settings) + background indicators */}
      <div className="flex items-center justify-self-end gap-1 md:justify-self-start">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'size-7',
                aiOpen && 'border border-ai/30 bg-ai-soft text-ai hover:bg-ai-soft hover:text-ai'
              )}
              style={noDragStyle}
              onClick={onToggleAI}
            >
              <Bot className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>AI Assistant</p>
            <p className="text-xs text-muted-foreground">⌘⇧A</p>
          </TooltipContent>
        </Tooltip>
        <div style={noDragStyle}>
          <ModelDownloadIndicator />
        </div>
        <div style={noDragStyle}>
          <IndexingStatusIndicator />
        </div>
      </div>
    </div>
  )
}
