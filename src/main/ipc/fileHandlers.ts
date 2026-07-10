import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { FileSystemManager, Note, FolderMetadata, OrderedItem } from '../utils/fileSystem'
import type { SerializedEditorState } from 'lexical'

type GetFsManager = (spaceId: string) => FileSystemManager

/**
 * Callback invoked after a note is saved (create or update).
 * Used by the auto-indexing system to enqueue background indexing.
 */
export type OnNoteSaved = (
  noteId: string,
  spaceId: string,
  folderId: string,
  rawContent: unknown,
  title: string,
  folderPath?: string
) => void

export type OnFolderMoved = (spaceId: string, folderId: string) => Promise<void>

/**
 * Callback invoked after one or more notes are deleted (single note or every
 * note under a deleted folder). Used to purge their embeddings from the vector
 * DB so deleted notes don't linger as orphaned search results.
 */
export type OnNotesDeleted = (spaceId: string, noteIds: string[]) => Promise<void>

/**
 * Collect the ids of every note under a folder subtree (inclusive), by walking
 * folder metadata. Used before deleting a folder so its notes can be purged
 * from the vector index.
 */
async function collectNoteIdsRecursively(
  fsManager: FileSystemManager,
  folderId: string,
  acc: string[]
): Promise<void> {
  const meta = await fsManager.readFolderMetadata(folderId)
  acc.push(...meta.noteIds)
  for (const childId of meta.children) {
    await collectNoteIdsRecursively(fsManager, childId, acc)
  }
}

export function registerFileHandlers(
  getOrCreateFsManager: GetFsManager,
  onNoteSaved?: OnNoteSaved,
  onFolderMoved?: OnFolderMoved,
  onNotesDeleted?: OnNotesDeleted
): void {
  // Note operations
  ipcMain.handle(
    'fs:createNote',
    async (
      _event: IpcMainInvokeEvent,
      spaceId: string,
      folderId: string,
      content: SerializedEditorState,
      title: string,
      type?: 'note' | 'meeting'
    ) => {
      try {
        const fsManager = getOrCreateFsManager(spaceId)
        const note = await fsManager.createNote(folderId, content, title, type)

        // Enqueue background indexing (non-blocking) — resolve full folder path for semantic search
        let folderPath: string | undefined
        try {
          folderPath = await fsManager.getFullFolderPath(folderId)
        } catch {
          /* ignore */
        }
        onNoteSaved?.(note.id, spaceId, folderId, note.content, note.title, folderPath)

        return note
      } catch (error) {
        throw new Error(`Failed to create note: ${(error as Error).message}`)
      }
    }
  )

  ipcMain.handle(
    'fs:readNote',
    async (_event: IpcMainInvokeEvent, spaceId: string, folderId: string, noteId: string) => {
      try {
        const fsManager = getOrCreateFsManager(spaceId)
        return await fsManager.readNote(folderId, noteId)
      } catch (error) {
        throw new Error(`Failed to read note: ${(error as Error).message}`)
      }
    }
  )

  ipcMain.handle(
    'fs:updateNote',
    async (
      _event: IpcMainInvokeEvent,
      spaceId: string,
      folderId: string,
      noteId: string,
      updates: Partial<Note>
    ) => {
      try {
        const fsManager = getOrCreateFsManager(spaceId)
        const updatedNote = await fsManager.updateNote(folderId, noteId, updates)

        // Enqueue background indexing when content or title changes (non-blocking)
        if (updates.content !== undefined || updates.title !== undefined) {
          let folderPath: string | undefined
          try {
            folderPath = await fsManager.getFullFolderPath(folderId)
          } catch {
            /* ignore */
          }
          onNoteSaved?.(
            noteId,
            spaceId,
            folderId,
            updatedNote.content,
            updatedNote.title,
            folderPath
          )
        }

        return updatedNote
      } catch (error) {
        throw new Error(`Failed to update note: ${(error as Error).message}`)
      }
    }
  )

  ipcMain.handle(
    'fs:deleteNote',
    async (_event: IpcMainInvokeEvent, spaceId: string, folderId: string, noteId: string) => {
      try {
        const fsManager = getOrCreateFsManager(spaceId)
        await fsManager.deleteNote(folderId, noteId)
        // Purge the deleted note's embeddings so it can't resurface in search.
        await onNotesDeleted?.(spaceId, [noteId])
      } catch (error) {
        throw new Error(`Failed to delete note: ${(error as Error).message}`)
      }
    }
  )

  ipcMain.handle(
    'fs:listNotes',
    async (_event: IpcMainInvokeEvent, spaceId: string, folderId: string) => {
      try {
        const fsManager = getOrCreateFsManager(spaceId)
        return await fsManager.listNotes(folderId)
      } catch (error) {
        throw new Error(`Failed to list notes: ${(error as Error).message}`)
      }
    }
  )

  // Folder operations
  ipcMain.handle(
    'fs:createFolder',
    async (_event: IpcMainInvokeEvent, spaceId: string, name: string, parentId?: string) => {
      try {
        const fsManager = getOrCreateFsManager(spaceId)
        return await fsManager.createFolder(name, parentId)
      } catch (error) {
        throw new Error(`Failed to create folder: ${(error as Error).message}`)
      }
    }
  )

  ipcMain.handle(
    'fs:readFolderMetadata',
    async (_event: IpcMainInvokeEvent, spaceId: string, folderId: string) => {
      try {
        const fsManager = getOrCreateFsManager(spaceId)
        return await fsManager.readFolderMetadata(folderId)
      } catch (error) {
        throw new Error(`Failed to read folder metadata: ${(error as Error).message}`)
      }
    }
  )

  ipcMain.handle(
    'fs:updateFolderMetadata',
    async (
      _event: IpcMainInvokeEvent,
      spaceId: string,
      folderId: string,
      updates: Partial<FolderMetadata>
    ) => {
      try {
        const fsManager = getOrCreateFsManager(spaceId)
        return await fsManager.updateFolderMetadata(folderId, updates)
      } catch (error) {
        throw new Error(`Failed to update folder metadata: ${(error as Error).message}`)
      }
    }
  )

  ipcMain.handle(
    'fs:deleteFolder',
    async (_event: IpcMainInvokeEvent, spaceId: string, folderId: string) => {
      try {
        const fsManager = getOrCreateFsManager(spaceId)
        // Collect the subtree's note ids BEFORE deleting so we can purge their
        // embeddings afterwards.
        const deletedNoteIds: string[] = []
        if (onNotesDeleted) {
          try {
            await collectNoteIdsRecursively(fsManager, folderId, deletedNoteIds)
          } catch {
            // If enumeration fails the batch orphan-prune will still clean up.
          }
        }
        await fsManager.deleteFolder(folderId)
        await onNotesDeleted?.(spaceId, deletedNoteIds)
      } catch (error) {
        throw new Error(`Failed to delete folder: ${(error as Error).message}`)
      }
    }
  )

  ipcMain.handle('fs:getFolderTree', async (_event: IpcMainInvokeEvent, spaceId: string) => {
    try {
      const fsManager = getOrCreateFsManager(spaceId)
      return await fsManager.getFolderTree()
    } catch (error) {
      throw new Error(`Failed to get folder tree: ${(error as Error).message}`)
    }
  })

  // Move operations
  ipcMain.handle(
    'fs:moveNote',
    async (
      _event: IpcMainInvokeEvent,
      spaceId: string,
      noteId: string,
      sourceFolderId: string,
      targetFolderId: string,
      targetIndex?: number
    ) => {
      try {
        const fsManager = getOrCreateFsManager(spaceId)
        const movedNote = await fsManager.moveNote(
          noteId,
          sourceFolderId,
          targetFolderId,
          targetIndex
        )

        // Re-index with the updated folder path (non-blocking)
        let folderPath: string | undefined
        try {
          folderPath = await fsManager.getFullFolderPath(targetFolderId)
        } catch {
          /* ignore */
        }
        onNoteSaved?.(
          noteId,
          spaceId,
          targetFolderId,
          movedNote.content,
          movedNote.title,
          folderPath
        )

        return movedNote
      } catch (error) {
        throw new Error(`Failed to move note: ${(error as Error).message}`)
      }
    }
  )

  ipcMain.handle(
    'fs:moveFolder',
    async (
      _event: IpcMainInvokeEvent,
      spaceId: string,
      folderId: string,
      targetParentId: string,
      targetIndex?: number
    ) => {
      try {
        const fsManager = getOrCreateFsManager(spaceId)
        const result = await fsManager.moveFolder(folderId, targetParentId, targetIndex)

        // Re-index all notes in the moved subtree with updated folder paths (non-blocking)
        onFolderMoved?.(spaceId, folderId).catch(console.error)

        return result
      } catch (error) {
        throw new Error(`Failed to move folder: ${(error as Error).message}`)
      }
    }
  )

  // Reorder the interleaved children (notes + subfolders) of a folder.
  // Order-only: no note files move on disk, so no re-indexing is required.
  ipcMain.handle(
    'fs:reorderItems',
    async (
      _event: IpcMainInvokeEvent,
      spaceId: string,
      parentFolderId: string,
      orderedItems: OrderedItem[]
    ) => {
      try {
        const fsManager = getOrCreateFsManager(spaceId)
        return await fsManager.reorderItems(parentFolderId, orderedItems)
      } catch (error) {
        throw new Error(`Failed to reorder items: ${(error as Error).message}`)
      }
    }
  )

  // Asset operations
  ipcMain.handle(
    'fs:saveAsset',
    async (
      _event: IpcMainInvokeEvent,
      spaceId: string,
      originalName: string,
      buffer: Uint8Array,
      type: 'image' | 'pdf' | 'attachment'
    ) => {
      try {
        const fsManager = getOrCreateFsManager(spaceId)
        return await fsManager.saveAsset(originalName, Buffer.from(buffer), type)
      } catch (error) {
        throw new Error(`Failed to save asset: ${(error as Error).message}`)
      }
    }
  )

  ipcMain.handle(
    'fs:readAsset',
    async (
      _event: IpcMainInvokeEvent,
      spaceId: string,
      assetId: string,
      type: 'image' | 'pdf' | 'attachment'
    ) => {
      try {
        const fsManager = getOrCreateFsManager(spaceId)
        const buffer = await fsManager.readAsset(assetId, type)
        return buffer
      } catch (error) {
        throw new Error(`Failed to read asset: ${(error as Error).message}`)
      }
    }
  )

  ipcMain.handle(
    'fs:deleteAsset',
    async (
      _event: IpcMainInvokeEvent,
      spaceId: string,
      assetId: string,
      type: 'image' | 'pdf' | 'attachment'
    ) => {
      try {
        const fsManager = getOrCreateFsManager(spaceId)
        await fsManager.deleteAsset(assetId, type)
      } catch (error) {
        throw new Error(`Failed to delete asset: ${(error as Error).message}`)
      }
    }
  )

  // Database path
  ipcMain.handle('fs:getDatabasePath', async (_event: IpcMainInvokeEvent, spaceId: string) => {
    try {
      const fsManager = getOrCreateFsManager(spaceId)
      return fsManager.getDatabasePath()
    } catch (error) {
      throw new Error(`Failed to get database path: ${(error as Error).message}`)
    }
  })

  // Cross-space move operations
  ipcMain.handle(
    'fs:moveNoteToSpace',
    async (
      _event: IpcMainInvokeEvent,
      sourceSpaceId: string,
      targetSpaceId: string,
      noteId: string,
      sourceFolderId: string
    ) => {
      try {
        const sourceFsManager = getOrCreateFsManager(sourceSpaceId)
        const targetFsManager = getOrCreateFsManager(targetSpaceId)
        return await sourceFsManager.moveNoteToSpace(targetFsManager, noteId, sourceFolderId)
      } catch (error) {
        throw new Error(`Failed to move note to space: ${(error as Error).message}`)
      }
    }
  )

  ipcMain.handle(
    'fs:moveFolderToSpace',
    async (
      _event: IpcMainInvokeEvent,
      sourceSpaceId: string,
      targetSpaceId: string,
      folderId: string
    ) => {
      try {
        const sourceFsManager = getOrCreateFsManager(sourceSpaceId)
        const targetFsManager = getOrCreateFsManager(targetSpaceId)
        return await sourceFsManager.moveFolderToSpace(targetFsManager, folderId)
      } catch (error) {
        throw new Error(`Failed to move folder to space: ${(error as Error).message}`)
      }
    }
  )
}
