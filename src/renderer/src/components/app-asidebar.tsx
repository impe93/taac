import { useNavigate } from '@tanstack/react-router'
import { MessageSquare, Settings } from 'lucide-react'
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
import { SpaceHeader } from './spaces/space-header'
import { SpaceSelector } from './spaces/space-selector'
import { NotesTree } from './notes-tree/NotesTree'
import { DndProvider } from './dnd/DndProvider'

export function AppSidebar() {
  const navigate = useNavigate()

  return (
    <Sidebar>
      <DndProvider>
        <SidebarHeader>
          <SpaceHeader />
        </SidebarHeader>
        <SidebarGroup className="py-0">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={() => navigate({ to: '/ai/chat' })} tooltip="AI Chat">
                  <MessageSquare className="size-4" />
                  <span>AI Chat</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => navigate({ to: '/settings/ai' })}
                  tooltip="AI Settings"
                >
                  <Settings className="size-4" />
                  <span>AI Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarContent>
          <NotesTree />
        </SidebarContent>
        <SidebarFooter>
          <SpaceSelector />
        </SidebarFooter>
      </DndProvider>
    </Sidebar>
  )
}
