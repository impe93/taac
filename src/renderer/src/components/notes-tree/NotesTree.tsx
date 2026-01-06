import { type FC, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAppDispatch, useAppSelector } from '@renderer/store/hooks'
import {
  selectRootFolder,
  selectIsLoading,
  selectError,
  selectIsFullyHydrated,
  selectActiveSpaceId,
  loadTree,
  moveNote,
  moveFolder
} from '@renderer/store/slices/notesTreeSlice'
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
import { TreeFolder } from './TreeFolder'
import { TreeNote } from './TreeNote'
import { EmptyTreeArea } from './EmptyTreeArea'
import { CreateItemDialog } from './CreateItemDialog'
import { DeleteItemDialog } from './DeleteItemDialog'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { Button } from '@renderer/components/ui/button'
import { Folder, FileText } from 'lucide-react'
import { toast } from 'sonner'

export const NotesTree: FC = () => {
  const dispatch = useAppDispatch()
  const rootFolder = useAppSelector(selectRootFolder)
  const isLoading = useAppSelector(selectIsLoading)
  const error = useAppSelector(selectError)
  const isFullyHydrated = useAppSelector(selectIsFullyHydrated)
  const activeSpaceId = useAppSelector(selectActiveSpaceId)

  // Dialog state management (lifted state)
  const [createDialog, setCreateDialog] = useState<{
    open: boolean
    type: 'note' | 'folder'
    parentFolderId: string
  }>({
    open: false,
    type: 'note',
    parentFolderId: 'root'
  })

  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean
    type: 'note' | 'folder'
    itemId: string
    itemName: string
    folderId?: string
  } | null>(null)

  // Callbacks per child components
  const handleCreateNote = (parentFolderId: string): void => {
    setCreateDialog({ open: true, type: 'note', parentFolderId })
  }

  const handleCreateFolder = (parentFolderId: string): void => {
    setCreateDialog({ open: true, type: 'folder', parentFolderId })
  }

  const handleDeleteNote = (noteId: string, noteName: string, folderId: string): void => {
    setDeleteDialog({ open: true, type: 'note', itemId: noteId, itemName: noteName, folderId })
  }

  const handleDeleteFolder = (folderId: string, folderName: string): void => {
    setDeleteDialog({ open: true, type: 'folder', itemId: folderId, itemName: folderName })
  }

  // Drag & Drop state
  const [activeItem, setActiveItem] = useState<{
    type: 'note' | 'folder'
    id: string
    name: string
  } | null>(null)

  // Configure sensors with activation constraints
  // Require 10px mouse movement before activating drag (prevents accidental drag on click)
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
    const { type, id, name } = active.data.current as {
      type: 'note' | 'folder'
      id: string
      name: string
    }

    setActiveItem({ type, id, name })
  }

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event

    setActiveItem(null)

    if (!over) return

    const draggedItem = active.data.current as {
      type: 'note' | 'folder'
      id: string
      folderId: string
    }

    const dropTarget = over.data.current as {
      type: 'folder'
      folderId: string
    }

    // Handle drop logic
    handleDrop(draggedItem, dropTarget)
  }

  const handleDrop = (
    draggedItem: { type: 'note' | 'folder'; id: string; folderId: string },
    dropTarget: { type: 'folder'; folderId: string }
  ): void => {
    if (!activeSpaceId) return

    if (draggedItem.type === 'note') {
      // Move note
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
      // Move folder
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

  // Loading state (skeleton)
  if (!isFullyHydrated && isLoading) {
    return (
      <div className="p-4 space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="p-4 space-y-2">
        <p className="text-sm text-destructive">Error: {error}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => activeSpaceId && dispatch(loadTree({ spaceId: activeSpaceId }))}
        >
          Retry
        </Button>
      </div>
    )
  }

  // Empty state
  if (!rootFolder || (rootFolder.noteIds.length === 0 && rootFolder.children.length === 0)) {
    return (
      <EmptyTreeArea
        onCreateNote={() => handleCreateNote('root')}
        onCreateFolder={() => handleCreateFolder('root')}
      >
        <div className="p-4 text-center">
          <p className="text-sm text-muted-foreground mb-2">No notes or folders yet</p>
          <p className="text-xs text-muted-foreground">
            Right-click here to create your first note or folder
          </p>
        </div>
        <CreateItemDialog
          type={createDialog.type}
          parentFolderId={createDialog.parentFolderId}
          open={createDialog.open}
          onOpenChange={(open) => setCreateDialog((prev) => ({ ...prev, open }))}
        />
        {deleteDialog && (
          <DeleteItemDialog
            type={deleteDialog.type}
            itemId={deleteDialog.itemId}
            itemName={deleteDialog.itemName}
            folderId={deleteDialog.folderId}
            open={deleteDialog.open}
            onOpenChange={(open) => setDeleteDialog(open ? deleteDialog : null)}
          />
        )}
      </EmptyTreeArea>
    )
  }

  // Tree rendering
  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <ScrollArea className="flex-1">
          <EmptyTreeArea
            onCreateNote={() => handleCreateNote('root')}
            onCreateFolder={() => handleCreateFolder('root')}
          >
            <div className="p-2 space-y-1">
              {/* Note root level */}
              {rootFolder.noteIds.map((noteId) => (
                <TreeNote
                  key={noteId}
                  noteId={noteId}
                  folderId="root"
                  level={0}
                  onDelete={handleDeleteNote}
                />
              ))}

              {/* Cartelle root level */}
              {rootFolder.children.map((childId) => (
                <TreeFolder
                  key={childId}
                  folderId={childId}
                  level={0}
                  onCreateNote={handleCreateNote}
                  onCreateFolder={handleCreateFolder}
                  onDeleteFolder={handleDeleteFolder}
                  onDeleteNote={handleDeleteNote}
                />
              ))}
            </div>
          </EmptyTreeArea>
        </ScrollArea>

        {/* Drag Overlay (ghost) */}
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

      {/* Dialogs */}
      <CreateItemDialog
        type={createDialog.type}
        parentFolderId={createDialog.parentFolderId}
        open={createDialog.open}
        onOpenChange={(open) => setCreateDialog((prev) => ({ ...prev, open }))}
      />

      {deleteDialog && (
        <DeleteItemDialog
          type={deleteDialog.type}
          itemId={deleteDialog.itemId}
          itemName={deleteDialog.itemName}
          folderId={deleteDialog.folderId}
          open={deleteDialog.open}
          onOpenChange={(open) => setDeleteDialog(open ? deleteDialog : null)}
        />
      )}
    </>
  )
}
