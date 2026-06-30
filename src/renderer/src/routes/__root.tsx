import '@fontsource-variable/hanken-grotesk'
import '@fontsource/instrument-serif'
import '@fontsource/instrument-serif/400-italic.css'
import '@fontsource-variable/jetbrains-mono'
import '../assets/global.css'
import { type FC } from 'react'
import { createRootRoute, Outlet, useNavigate } from '@tanstack/react-router'
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
import { Bot, Settings } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useConfig } from '@renderer/hooks/useConfig'
import { IndexingStatusIndicator } from '@renderer/components/ai/IndexingStatusIndicator'

const RootLayout: FC = () => {
  const isMacOS = window.platform === 'darwin'
  const { isOpen, toggle } = useAIChatPanel()
  const navigate = useNavigate()
  const { data: onboardingDone, isLoading } = useConfig('onboardingCompleted')

  // Show minimal layout during onboarding or while loading config
  if (isLoading || !onboardingDone) {
    return (
      <>
        <WindowDragBorder />
        <div
          className="h-screen w-full"
          style={{
            padding: WINDOW_BORDER_WIDTH,
            paddingTop: isMacOS ? WINDOW_TRAFFIC_LIGHTS_HEIGHT : WINDOW_BORDER_WIDTH
          }}
        >
          <div className="h-full overflow-hidden rounded-xl bg-background">
            <Outlet />
          </div>
        </div>
      </>
    )
  }

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
          <SidebarInset className="bg-editor">
            <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
              <div className="flex items-center gap-2 px-4">
                <SidebarTrigger className="-ml-1" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => navigate({ to: '/settings' })}
                    >
                      <Settings className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>Settings</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              {/* Indexing status + AI Panel toggle */}
              <div className="hidden items-center gap-2 px-4 md:flex">
                <IndexingStatusIndicator />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn(
                        'size-8 text-muted-foreground',
                        isOpen &&
                          'border border-ai/30 bg-ai-soft text-ai hover:bg-ai-soft hover:text-ai'
                      )}
                      onClick={toggle}
                    >
                      <Bot className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>{isOpen ? 'Close' : 'Open'} AI Assistant</p>
                    <p className="text-xs text-muted-foreground">⌘⇧A</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </header>
            <MainContentWithAIPanel className="min-h-0 flex-1">
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
