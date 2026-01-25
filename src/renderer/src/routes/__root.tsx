import '../assets/global.css'
import { createRootRoute, Outlet } from '@tanstack/react-router'
import { Providers } from '@renderer/components/providers'
import { SidebarTrigger } from '@renderer/components/ui/sidebar'
import { SidebarInset } from '@renderer/components/ui/sidebar'
import { AppSidebar } from '@renderer/components/app-asidebar'
import {
  WindowDragBorder,
  WINDOW_BORDER_WIDTH,
  WINDOW_TRAFFIC_LIGHTS_HEIGHT
} from '@renderer/components/window'

export const Route = createRootRoute({
  component: () => {
    const isMacOS = window.platform === 'darwin'

    return (
      <Providers>
        <WindowDragBorder />
        {/* Outer container with padding for the drag border */}
        <div
          className="h-screen"
          style={{
            padding: WINDOW_BORDER_WIDTH,
            paddingTop: isMacOS ? WINDOW_TRAFFIC_LIGHTS_HEIGHT : WINDOW_BORDER_WIDTH
          }}
        >
          {/* Inner container with rounded corners - clips all content */}
          <div className="flex h-full overflow-hidden rounded-xl">
            <AppSidebar />
            <SidebarInset>
              <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
                <div className="flex items-center gap-2 px-4">
                  <SidebarTrigger className="-ml-1" />
                </div>
              </header>
              <div className="flex flex-1 p-4">
                <Outlet />
              </div>
            </SidebarInset>
          </div>
        </div>
      </Providers>
    )
  }
})
