import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader } from '@renderer/components/ui/sidebar'
import { SpaceHeader } from './spaces/space-header'
import { SpaceSelector } from './spaces/space-selector'
import { NotesTree } from './notes-tree/NotesTree'
import { DndProvider } from './dnd/DndProvider'

export function AppSidebar() {
  return (
    <Sidebar>
      <DndProvider>
        <SidebarHeader>
          <SpaceHeader />
        </SidebarHeader>
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
