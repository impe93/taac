import { createContext, useContext, useState, type FC, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  DndContext,
  DragOverlay,
  closestCorners,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useAppDispatch, useAppSelector } from '@renderer/store/hooks'
import {
  selectActiveSpaceId,
  selectOrderedItems,
  moveNote,
  moveFolder,
  reorderItems,
  moveNoteToSpace,
  moveFolderToSpace,
  loadTree
} from '@renderer/store/slices/notesTreeSlice'
import { store } from '@renderer/store'
import type { OrderedItem } from '@preload/types'
import { Folder, FileText } from 'lucide-react'
import { toast } from 'sonner'

// Types for drag items. `folderId` is the parent/container of the dragged item.
export interface DragItem {
  type: 'note' | 'folder'
  id: string
  name: string
  folderId: string
}

export interface DropTarget {
  type: 'folder' | 'space'
  folderId?: string
  spaceId?: string
}

// Where the drop will land relative to the item currently hovered.
export type DropZone = 'before' | 'after' | 'inside'

export interface DropIndicator {
  // Drag-and-drop id of the hovered item, e.g. `note-<id>` / `folder-<id>`.
  overId: string
  zone: DropZone
}

// Context for sharing drag state with tree items (overlay + drop indicators)
interface DndContextValue {
  activeItem: DragItem | null
  dropIndicator: DropIndicator | null
}

const DndStateContext = createContext<DndContextValue | null>(null)

export const useDndState = (): DndContextValue => {
  const context = useContext(DndStateContext)
  if (!context) {
    throw new Error('useDndState must be used within DndProvider')
  }
  return context
}

// Compute whether the drop is a reorder (before/after) or a nest (inside a
// folder), based on the pointer's vertical position within the hovered row.
function computeZone(
  active: DragEndEvent['active'],
  over: NonNullable<DragEndEvent['over']>,
  overType: 'note' | 'folder'
): DropZone {
  const overRect = over.rect
  const activeRect = active.rect.current.translated
  const pointerY = activeRect
    ? activeRect.top + activeRect.height / 2
    : overRect.top + overRect.height / 2
  const ratio = overRect.height > 0 ? (pointerY - overRect.top) / overRect.height : 0.5

  if (overType === 'folder') {
    if (ratio < 0.25) return 'before'
    if (ratio > 0.75) return 'after'
    return 'inside'
  }
  return ratio < 0.5 ? 'before' : 'after'
}

interface DndProviderProps {
  children: ReactNode
}

export const DndProvider: FC<DndProviderProps> = ({ children }) => {
  const dispatch = useAppDispatch()
  const activeSpaceId = useAppSelector(selectActiveSpaceId)

  // Drag state
  const [activeItem, setActiveItem] = useState<DragItem | null>(null)
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null)

  // Configure sensors with activation constraints
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 10
      }
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 5
      }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  )

  const handleDragStart = (event: DragStartEvent): void => {
    const { active } = event
    const data = active.data.current as DragItem

    if (data) {
      setActiveItem(data)
    }
  }

  const handleDragOver = (event: DragOverEvent): void => {
    const { active, over } = event

    if (!over) {
      setDropIndicator(null)
      return
    }

    const dropTarget = over.data.current as DropTarget | undefined
    const overItem = over.data.current as DragItem | undefined

    // Special droppables (space tabs, root drop zone) have no reorder indicator
    if (!overItem || dropTarget?.type === 'space' || over.id === 'folder-drop-root') {
      setDropIndicator(null)
      return
    }

    // Don't show an indicator on the item being dragged itself
    if (overItem.id === (active.data.current as DragItem)?.id) {
      setDropIndicator(null)
      return
    }

    const zone = computeZone(active, over, overItem.type)
    setDropIndicator({ overId: String(over.id), zone })
  }

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event

    setActiveItem(null)
    setDropIndicator(null)

    if (!over || !activeSpaceId) return

    const draggedItem = active.data.current as DragItem
    const dropTarget = over.data.current as DropTarget

    if (!draggedItem || !dropTarget) return

    // Cross-space move (dropped on a space tab)
    if (dropTarget.type === 'space') {
      handleCrossSpaceDrop(draggedItem, dropTarget)
      return
    }

    // Move to root level (dedicated drop zone)
    if (over.id === 'folder-drop-root') {
      handleMoveInto(draggedItem, 'root')
      return
    }

    // Otherwise we dropped over another tree item (sortable)
    const overItem = over.data.current as DragItem
    if (!overItem) return

    // Dropped on itself: nothing to do
    if (overItem.id === draggedItem.id) return

    const zone = computeZone(active, over, overItem.type)

    // Nest inside a folder (drop on the middle band of a folder row)
    if (zone === 'inside' && overItem.type === 'folder') {
      if (overItem.id === draggedItem.id) return
      handleMoveInto(draggedItem, overItem.id)
      return
    }

    // Reorder (before/after the hovered item) within its container
    const containerId = overItem.folderId
    handleReorder(draggedItem, overItem, zone, containerId)
  }

  const handleCrossSpaceDrop = (draggedItem: DragItem, dropTarget: DropTarget): void => {
    if (!activeSpaceId || !dropTarget.spaceId) return

    const targetSpaceId = dropTarget.spaceId

    // Check if dropping on same space
    if (targetSpaceId === activeSpaceId) {
      toast.warning('Item is already in this space')
      return
    }

    if (draggedItem.type === 'note') {
      dispatch(
        moveNoteToSpace({
          sourceSpaceId: activeSpaceId,
          targetSpaceId,
          noteId: draggedItem.id,
          sourceFolderId: draggedItem.folderId
        })
      )
        .unwrap()
        .then(() => {
          toast.success('Note moved to space')
        })
        .catch((error) => {
          toast.error((error as Error).message || 'Failed to move note to space')
          // Reload tree to restore state on failure
          dispatch(loadTree({ spaceId: activeSpaceId }))
        })
    } else if (draggedItem.type === 'folder') {
      dispatch(
        moveFolderToSpace({
          sourceSpaceId: activeSpaceId,
          targetSpaceId,
          folderId: draggedItem.id
        })
      )
        .unwrap()
        .then(() => {
          toast.success('Folder moved to space')
        })
        .catch((error) => {
          toast.error((error as Error).message || 'Failed to move folder to space')
          // Reload tree to restore state on failure
          dispatch(loadTree({ spaceId: activeSpaceId }))
        })
    }
  }

  // Move an item INTO a folder (append). Preserves the original move-into gesture.
  const handleMoveInto = (draggedItem: DragItem, targetFolderId: string): void => {
    if (!activeSpaceId) return
    if (draggedItem.folderId === targetFolderId) return // already there

    if (draggedItem.type === 'note') {
      dispatch(
        moveNote({
          spaceId: activeSpaceId,
          noteId: draggedItem.id,
          sourceFolderId: draggedItem.folderId,
          targetFolderId
        })
      )
        .unwrap()
        .then(() => toast.success('Note moved successfully'))
        .catch((error) => toast.error((error as Error).message || 'Failed to move note'))
    } else {
      if (draggedItem.id === targetFolderId) {
        toast.error('Cannot move folder into itself')
        return
      }
      dispatch(
        moveFolder({
          spaceId: activeSpaceId,
          folderId: draggedItem.id,
          currentParentId: draggedItem.folderId,
          targetParentId: targetFolderId
        })
      )
        .unwrap()
        .then(() => toast.success('Folder moved successfully'))
        .catch((error) => toast.error((error as Error).message || 'Failed to move folder'))
    }
  }

  // Reorder within a container, or move into a different container at a position.
  const handleReorder = (
    draggedItem: DragItem,
    overItem: DragItem,
    zone: DropZone,
    containerId: string
  ): void => {
    if (!activeSpaceId) return

    const state = store.getState()
    const list = selectOrderedItems(containerId)(state)
    const overIndex = list.findIndex((item) => item.id === overItem.id)
    if (overIndex === -1) return

    if (draggedItem.folderId === containerId) {
      // Same container: pure reorder
      const without = list.filter((item) => item.id !== draggedItem.id)
      const overIndexWithout = without.findIndex((item) => item.id === overItem.id)
      const target = zone === 'before' ? overIndexWithout : overIndexWithout + 1
      const moved: OrderedItem = { type: draggedItem.type, id: draggedItem.id }
      const newOrder = [...without.slice(0, target), moved, ...without.slice(target)]

      // No-op if order is unchanged
      if (newOrder.every((item, idx) => item.id === list[idx]?.id)) return

      dispatch(
        reorderItems({
          spaceId: activeSpaceId,
          parentFolderId: containerId,
          orderedItems: newOrder,
          previousItems: list
        })
      )
        .unwrap()
        .catch((error) => toast.error((error as Error).message || 'Failed to reorder items'))
      return
    }

    // Different container: move into it at the computed index
    const targetIndex = zone === 'before' ? overIndex : overIndex + 1

    if (draggedItem.type === 'note') {
      dispatch(
        moveNote({
          spaceId: activeSpaceId,
          noteId: draggedItem.id,
          sourceFolderId: draggedItem.folderId,
          targetFolderId: containerId,
          targetIndex
        })
      )
        .unwrap()
        .then(() => toast.success('Note moved successfully'))
        .catch((error) => toast.error((error as Error).message || 'Failed to move note'))
    } else {
      if (draggedItem.id === containerId) {
        toast.error('Cannot move folder into itself')
        return
      }
      dispatch(
        moveFolder({
          spaceId: activeSpaceId,
          folderId: draggedItem.id,
          currentParentId: draggedItem.folderId,
          targetParentId: containerId,
          targetIndex
        })
      )
        .unwrap()
        .then(() => toast.success('Folder moved successfully'))
        .catch((error) => toast.error((error as Error).message || 'Failed to move folder'))
    }
  }

  return (
    <DndStateContext.Provider value={{ activeItem, dropIndicator }}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        {children}

        {/* Global Drag Overlay */}
        {createPortal(
          <DragOverlay>
            {activeItem && (
              <div className="bg-accent/90 backdrop-blur-sm px-3 py-2 rounded-md shadow-lg border border-border flex items-center gap-2">
                {activeItem.type === 'folder' ? (
                  <Folder className="size-4 text-muted-foreground" />
                ) : (
                  <FileText className="size-4 text-muted-foreground" />
                )}
                <span className="text-sm font-medium">{activeItem.name}</span>
              </div>
            )}
          </DragOverlay>,
          document.body
        )}
      </DndContext>
    </DndStateContext.Provider>
  )
}
