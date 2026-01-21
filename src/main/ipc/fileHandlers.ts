import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { FileSystemManager, Note, FolderMetadata } from '../utils/fileSystem'
import type { SerializedEditorState } from 'lexical'

type GetFsManager = (spaceId: string) => FileSystemManager

export function registerFileHandlers(getOrCreateFsManager: GetFsManager): void {
  // Note operations
  ipcMain.handle(
    'fs:createNote',
    async (
      _event: IpcMainInvokeEvent,
      spaceId: string,
      folderId: string,
      content: SerializedEditorState,
      title: string
    ) => {
      try {
        const fsManager = getOrCreateFsManager(spaceId)
        return await fsManager.createNote(folderId, content, title)
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
        return await fsManager.updateNote(folderId, noteId, updates)
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
        await fsManager.deleteFolder(folderId)
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
      targetFolderId: string
    ) => {
      try {
        const fsManager = getOrCreateFsManager(spaceId)
        return await fsManager.moveNote(noteId, sourceFolderId, targetFolderId)
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
      targetParentId: string
    ) => {
      try {
        const fsManager = getOrCreateFsManager(spaceId)
        return await fsManager.moveFolder(folderId, targetParentId)
      } catch (error) {
        throw new Error(`Failed to move folder: ${(error as Error).message}`)
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
