import { type FC } from 'react'
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter
} from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { useNoteTabs } from '@renderer/hooks/useNoteTabs'
import { useNoteTabsShortcuts } from '@renderer/hooks/useNoteTabsShortcuts'
import { NoteTab } from './NoteTab'

/**
 * Barra orizzontale delle schede note. Renderizzata nel layout persistente sopra
 * l'area editor; si auto-nasconde quando non ci sono schede aperte. Possiede un
 * proprio DndContext (isolato da quello della sidebar) per il riordino orizzontale;
 * il riordino aggiorna solo Redux (nessuna chiamata IPC).
 */
export const NoteTabsBar: FC = () => {
  const { openTabs, activeNoteId, focusTab, closeTab, reorder } = useNoteTabs()
  useNoteTabsShortcuts()

  // Sensore con soglia di 8px così un semplice click non avvia il drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = openTabs.indexOf(String(active.id))
    const newIndex = openTabs.indexOf(String(over.id))
    if (oldIndex === -1 || newIndex === -1) return
    reorder(arrayMove(openTabs, oldIndex, newIndex))
  }

  if (openTabs.length === 0) return null

  return (
    <div className="flex items-end gap-0.5 overflow-x-auto border-b border-border bg-muted/30 px-2 pt-1.5">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={openTabs} strategy={horizontalListSortingStrategy}>
          <div className="flex items-end gap-0.5">
            {openTabs.map((noteId) => (
              <NoteTab
                key={noteId}
                noteId={noteId}
                isActive={noteId === activeNoteId}
                onFocus={focusTab}
                onClose={closeTab}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}
