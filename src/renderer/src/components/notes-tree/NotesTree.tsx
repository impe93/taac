import { type FC, useState } from 'react'
import { useAppDispatch, useAppSelector } from '@renderer/store/hooks'
import {
  selectRootFolder,
  selectIsLoading,
  selectError,
  selectIsFullyHydrated,
  selectActiveSpaceId,
  loadTree
} from '@renderer/store/slices/notesTreeSlice'
import { TreeFolder } from './TreeFolder'
import { TreeNote } from './TreeNote'
import { EmptyTreeArea } from './EmptyTreeArea'
import { RootDropZone } from './RootDropZone'
import { CreateItemDialog } from './CreateItemDialog'
import { DeleteItemDialog } from './DeleteItemDialog'
import { RenameFolderDialog } from './RenameFolderDialog'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { Button } from '@renderer/components/ui/button'

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

  const [renameDialog, setRenameDialog] = useState<{
    open: boolean
    folderId: string
    currentName: string
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

  const handleRenameFolder = (folderId: string, folderName: string): void => {
    setRenameDialog({ open: true, folderId, currentName: folderName })
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
            Use the + button above or right-click here to get started
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
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
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
                onRenameFolder={handleRenameFolder}
                onDeleteFolder={handleDeleteFolder}
                onDeleteNote={handleDeleteNote}
              />
            ))}
          </div>
          <RootDropZone />
        </EmptyTreeArea>
      </div>

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

      {renameDialog && (
        <RenameFolderDialog
          folderId={renameDialog.folderId}
          currentName={renameDialog.currentName}
          open={renameDialog.open}
          onOpenChange={(open) => setRenameDialog(open ? renameDialog : null)}
        />
      )}
    </>
  )
}
