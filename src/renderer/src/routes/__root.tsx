import '@fontsource-variable/hanken-grotesk'
import '@fontsource/instrument-serif'
import '@fontsource/instrument-serif/400-italic.css'
import '@fontsource-variable/jetbrains-mono'
import '../assets/global.css'
import { type FC, useEffect, useState } from 'react'
import { createRootRoute, Outlet, useNavigate } from '@tanstack/react-router'
import { Providers } from '@renderer/components/providers'
import { SidebarInset } from '@renderer/components/ui/sidebar'
import { AppSidebar } from '@renderer/components/app-asidebar'
import { MainContentWithAIPanel } from '@renderer/components/layout/MainContentWithAIPanel'
import { useAIChatPanel } from '@renderer/hooks/useAIChatPanel'
import { AppTopBar, WINDOW_TOPBAR_HEIGHT } from '@renderer/components/window'
import { useConfig } from '@renderer/hooks/useConfig'
import { SearchCommandDialog } from '@renderer/components/search/SearchCommandDialog'
import { NoteTabsBar } from '@renderer/components/notes-tabs/NoteTabsBar'

const RootLayout: FC = () => {
  const isMacOS = window.platform === 'darwin'
  const { isOpen, toggle } = useAIChatPanel()
  const navigate = useNavigate()
  const { data: onboardingDone, isLoading } = useConfig('onboardingCompleted')
  const [searchOpen, setSearchOpen] = useState(false)

  // Global ⌘K / Ctrl+K to open the search modal.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Show minimal layout during onboarding or while loading config
  if (isLoading || !onboardingDone) {
    return (
      <>
        <AppTopBar isMacOS={isMacOS} minimal />
        <div className="h-screen w-full" style={{ paddingTop: WINDOW_TOPBAR_HEIGHT }}>
          <div className="h-full overflow-hidden bg-background">
            <Outlet />
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <AppTopBar
        isMacOS={isMacOS}
        onOpenSearch={() => setSearchOpen(true)}
        aiOpen={isOpen}
        onToggleAI={toggle}
        onOpenSettings={() => navigate({ to: '/settings' })}
      />
      {/* Content sits below the fixed top bar; edge-to-edge, no frame */}
      <div className="h-screen w-full" style={{ paddingTop: WINDOW_TOPBAR_HEIGHT }}>
        <div className="flex h-full w-full overflow-hidden">
          <AppSidebar />
          <SidebarInset className="bg-editor">
            <NoteTabsBar />
            <MainContentWithAIPanel className="min-h-0 flex-1">
              <div className="h-full w-full overflow-auto p-4">
                <Outlet />
              </div>
            </MainContentWithAIPanel>
          </SidebarInset>
        </div>
      </div>
      <SearchCommandDialog open={searchOpen} onOpenChange={setSearchOpen} />
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
