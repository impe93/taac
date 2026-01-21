import { createContext, useContext, useState, type FC, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  DndContext,
  DragOverlay,
  closestCorners,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { useAppDispatch, useAppSelector } from '@renderer/store/hooks'
import {
  selectActiveSpaceId,
  moveNote,
  moveFolder,
  moveNoteToSpace,
  moveFolderToSpace,
  loadTree
} from '@renderer/store/slices/notesTreeSlice'
import { Folder, FileText } from 'lucide-react'
import { toast } from 'sonner'

// Types for drag items
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

// Context for sharing drag state
interface DndContextValue {
  activeItem: DragItem | null
}

const DndStateContext = createContext<DndContextValue | null>(null)

export const useDndState = (): DndContextValue => {
  const context = useContext(DndStateContext)
  if (!context) {
    throw new Error('useDndState must be used within DndProvider')
  }
  return context
}

interface DndProviderProps {
  children: ReactNode
}

export const DndProvider: FC<DndProviderProps> = ({ children }) => {
  const dispatch = useAppDispatch()
  const activeSpaceId = useAppSelector(selectActiveSpaceId)

  // Drag state
  const [activeItem, setActiveItem] = useState<DragItem | null>(null)

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
    })
  )

  const handleDragStart = (event: DragStartEvent): void => {
    const { active } = event
    const data = active.data.current as DragItem

    if (data) {
      setActiveItem(data)
    }
  }

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event

    setActiveItem(null)

    if (!over || !activeSpaceId) return

    const draggedItem = active.data.current as DragItem
    const dropTarget = over.data.current as DropTarget

    if (!draggedItem || !dropTarget) return

    // Handle drop based on target type
    if (dropTarget.type === 'space') {
      // Cross-space move
      handleCrossSpaceDrop(draggedItem, dropTarget)
    } else if (dropTarget.type === 'folder') {
      // Within-space move
      handleWithinSpaceDrop(draggedItem, dropTarget)
    }
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

  const handleWithinSpaceDrop = (draggedItem: DragItem, dropTarget: DropTarget): void => {
    if (!activeSpaceId || !dropTarget.folderId) return

    if (draggedItem.type === 'note') {
      // Move note within space
      if (draggedItem.folderId !== dropTarget.folderId) {
        dispatch(
          moveNote({
            spaceId: activeSpaceId,
            noteId: draggedItem.id,
            sourceFolderId: draggedItem.folderId,
            targetFolderId: dropTarget.folderId
          })
        )
          .unwrap()
          .then(() => {
            toast.success('Note moved successfully')
          })
          .catch((error) => {
            toast.error((error as Error).message || 'Failed to move note')
          })
      }
    } else if (draggedItem.type === 'folder') {
      // Move folder within space
      if (draggedItem.folderId !== dropTarget.folderId) {
        // Validate not dropping into itself
        if (draggedItem.id === dropTarget.folderId) {
          toast.error('Cannot move folder into itself')
          return
        }

        dispatch(
          moveFolder({
            spaceId: activeSpaceId,
            folderId: draggedItem.id,
            currentParentId: draggedItem.folderId,
            targetParentId: dropTarget.folderId
          })
        )
          .unwrap()
          .then(() => {
            toast.success('Folder moved successfully')
          })
          .catch((error) => {
            toast.error((error as Error).message || 'Failed to move folder')
          })
      }
    }
  }

  return (
    <DndStateContext.Provider value={{ activeItem }}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
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
