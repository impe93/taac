import { Home, Inbox, Settings } from 'lucide-react'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem
} from '@renderer/components/ui/sidebar'
import { Link } from '@tanstack/react-router'
import { SpaceHeader } from './spaces/space-header'
import { SpaceSelector } from './spaces/space-selector'

// Menu items.
const items = [
  {
    title: 'Home',
    url: '/',
    icon: Home
  },
  {
    title: 'Dashboard',
    url: '/dashboard',
    icon: Inbox
  },
  {
    title: 'Settings',
    url: '/settings',
    icon: Settings
  }
]

export function AppSidebar() {
  return (
    <Sidebar>
      <SidebarHeader>
        <SpaceHeader />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <Link to={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SpaceSelector />
      </SidebarFooter>
    </Sidebar>
  )
}
