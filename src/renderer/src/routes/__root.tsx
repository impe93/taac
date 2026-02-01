import '../assets/global.css'
import { type FC } from 'react'
import { createRootRoute, Outlet } from '@tanstack/react-router'
import { Providers } from '@renderer/components/providers'
import { SidebarTrigger } from '@renderer/components/ui/sidebar'
import { SidebarInset } from '@renderer/components/ui/sidebar'
import { AppSidebar } from '@renderer/components/app-asidebar'
import { Button } from '@renderer/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { MainContentWithAIPanel } from '@renderer/components/layout/MainContentWithAIPanel'
import { useAIChatPanel } from '@renderer/hooks/useAIChatPanel'
import {
  WindowDragBorder,
  WINDOW_BORDER_WIDTH,
  WINDOW_TRAFFIC_LIGHTS_HEIGHT
} from '@renderer/components/window'
import { Bot } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

const RootLayout: FC = () => {
  const isMacOS = window.platform === 'darwin'
  const { isOpen, toggle } = useAIChatPanel()

  return (
    <>
      <WindowDragBorder />
      {/* Outer container with padding for the drag border */}
      <div
        className="h-screen w-full"
        style={{
          padding: WINDOW_BORDER_WIDTH,
          paddingTop: isMacOS ? WINDOW_TRAFFIC_LIGHTS_HEIGHT : WINDOW_BORDER_WIDTH
        }}
      >
        {/* Inner container with rounded corners - clips all content */}
        <div className="flex h-full overflow-hidden rounded-xl">
          <AppSidebar />
          <SidebarInset>
            <header className="flex h-16 shrink-0 items-center justify-between gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
              <div className="flex items-center gap-2 px-4">
                <SidebarTrigger className="-ml-1" />
              </div>
              {/* AI Panel toggle button */}
              <div className="hidden items-center gap-2 px-4 md:flex">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={isOpen ? 'default' : 'ghost'}
                      size="icon"
                      className={cn('size-8', isOpen && 'bg-primary text-primary-foreground')}
                      onClick={toggle}
                    >
                      <Bot className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>{isOpen ? 'Chiudi' : 'Apri'} AI Assistant</p>
                    <p className="text-xs text-muted-foreground">⌘⇧A</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </header>
            <MainContentWithAIPanel>
              <div className="h-full w-full overflow-auto p-4">
                <Outlet />
              </div>
            </MainContentWithAIPanel>
          </SidebarInset>
        </div>
      </div>
    </>
  )
}

export const Route = createRootRoute({
  component: () => (
    <Providers>
      <RootLayout />
    </Providers>
  )
})
