import { type ReactElement } from 'react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader
} from '@renderer/components/ui/sidebar'
import { SpaceHeader } from './spaces/space-header'
import { SpaceSelector } from './spaces/space-selector'
import { NotesTree } from './notes-tree/NotesTree'
import { DndProvider } from './dnd/DndProvider'
import { MeetingRecordingSidebarPanel } from './meeting/MeetingRecordingSidebarPanel'

export function AppSidebar(): ReactElement {
  return (
    <Sidebar resizable>
      <DndProvider>
        <SidebarHeader>
          <SpaceHeader />
        </SidebarHeader>
        <SidebarContent>
          <NotesTree />
        </SidebarContent>
        <MeetingRecordingSidebarPanel />
        <SidebarFooter>
          <SpaceSelector />
        </SidebarFooter>
      </DndProvider>
    </Sidebar>
  )
}
