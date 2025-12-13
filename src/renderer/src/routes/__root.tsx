import '../assets/global.css'
import { createRootRoute, Outlet } from '@tanstack/react-router'
import { Providers } from '@renderer/components/providers'
import { SidebarTrigger } from '@renderer/components/ui/sidebar'
import { SidebarInset } from '@renderer/components/ui/sidebar'
import { AppSidebar } from '@renderer/components/app-asidebar'

export const Route = createRootRoute({
  component: () => (
    <Providers>
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
    </Providers>
  )
})
