import { type FC, type ReactNode, useCallback, useRef } from 'react'
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle
} from '@renderer/components/ui/resizable'
import { Button } from '@renderer/components/ui/button'
import { AIChatPanel } from '@renderer/components/ai/AIChatPanel'
import { useAIChatPanel } from '@renderer/hooks/useAIChatPanel'
import { cn } from '@renderer/lib/utils'
import { Bot, X } from 'lucide-react'
import type { ImperativePanelHandle } from 'react-resizable-panels'

interface MainContentWithAIPanelProps {
  children: ReactNode
  className?: string
}

export const MainContentWithAIPanel: FC<MainContentWithAIPanelProps> = ({
  children,
  className
}) => {
  const { isOpen, panelSize, toggle, close, setPanelSize } = useAIChatPanel()
  const aiPanelRef = useRef<ImperativePanelHandle>(null)

  const handlePanelResize = useCallback(
    (sizes: number[]) => {
      if (sizes[1] !== undefined && sizes[1] !== panelSize) {
        setPanelSize(sizes[1])
      }
    },
    [panelSize, setPanelSize]
  )

  // Desktop: show resizable panel
  // Mobile: AI panel replaces content or is hidden
  return (
    <div className={cn('flex h-full w-full', className)}>
      {/* Desktop layout */}
      <div className="hidden h-full w-full md:flex">
        {isOpen ? (
          <ResizablePanelGroup direction="horizontal" onLayout={handlePanelResize}>
            <ResizablePanel defaultSize={100 - panelSize} minSize={40}>
              <div className="h-full w-full">{children}</div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel
              ref={aiPanelRef}
              defaultSize={panelSize}
              minSize={25}
              maxSize={50}
              collapsible
              collapsedSize={0}
              onCollapse={() => close()}
            >
              <div className="relative flex h-full flex-col border-l bg-sidebar">
                {/* Header with close button */}
                <div className="flex h-12 shrink-0 items-center justify-between border-b px-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Bot className="size-4 text-ai" />
                    <span>AI Assistant</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={close}
                    title="Close AI panel (⌘⇧A)"
                  >
                    <X className="size-4" />
                  </Button>
                </div>
                {/* AI Chat Panel content */}
                <div className="min-h-0 flex-1">
                  <AIChatPanel />
                </div>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <div className="h-full w-full">{children}</div>
        )}
      </div>

      {/* Mobile layout - simple toggle, no resizable */}
      <div className="flex h-full w-full flex-col md:hidden">
        {isOpen ? (
          <div className="relative flex h-full flex-col bg-sidebar">
            {/* Mobile header */}
            <div className="flex h-12 shrink-0 items-center justify-between border-b px-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Bot className="size-4 text-ai" />
                <span>AI Assistant</span>
              </div>
              <Button variant="ghost" size="icon" className="size-7" onClick={close}>
                <X className="size-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1">
              <AIChatPanel />
            </div>
          </div>
        ) : (
          <div className="h-full w-full">{children}</div>
        )}
      </div>

      {/* Floating AI button when panel is closed */}
      {!isOpen && (
        <Button
          onClick={toggle}
          size="icon"
          className="fixed bottom-6 right-6 z-50 size-12 rounded-full shadow-lg md:hidden"
          title="Open AI Assistant (⌘⇧A)"
        >
          <Bot className="size-5" />
        </Button>
      )}
    </div>
  )
}
