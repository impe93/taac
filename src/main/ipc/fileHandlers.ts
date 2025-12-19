import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { FileSystemManager, Note, FolderMetadata } from '../utils/fileSystem'
import type { SerializedEditorState } from 'lexical'

export function registerFileHandlers(fsManager: FileSystemManager): void {
  // Note operations
  ipcMain.handle(
    'fs:createNote',
    async (
      _event: IpcMainInvokeEvent,
      folderId: string,
      content: SerializedEditorState,
      title: string
    ) => {
      try {
        return await fsManager.createNote(folderId, content, title)
      } catch (error) {
        throw new Error(`Failed to create note: ${(error as Error).message}`)
      }
    }
  )

  ipcMain.handle(
    'fs:readNote',
    async (_event: IpcMainInvokeEvent, folderId: string, noteId: string) => {
      try {
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
      folderId: string,
      noteId: string,
      updates: Partial<Note>
    ) => {
      try {
        return await fsManager.updateNote(folderId, noteId, updates)
      } catch (error) {
        throw new Error(`Failed to update note: ${(error as Error).message}`)
      }
    }
  )

  ipcMain.handle(
    'fs:deleteNote',
    async (_event: IpcMainInvokeEvent, folderId: string, noteId: string) => {
      try {
        await fsManager.deleteNote(folderId, noteId)
      } catch (error) {
        throw new Error(`Failed to delete note: ${(error as Error).message}`)
      }
    }
  )

  ipcMain.handle('fs:listNotes', async (_event: IpcMainInvokeEvent, folderId: string) => {
    try {
      return await fsManager.listNotes(folderId)
    } catch (error) {
      throw new Error(`Failed to list notes: ${(error as Error).message}`)
    }
  })

  // Folder operations
  ipcMain.handle(
    'fs:createFolder',
    async (_event: IpcMainInvokeEvent, name: string, parentId?: string) => {
      try {
        return await fsManager.createFolder(name, parentId)
      } catch (error) {
        throw new Error(`Failed to create folder: ${(error as Error).message}`)
      }
    }
  )

  ipcMain.handle('fs:readFolderMetadata', async (_event: IpcMainInvokeEvent, folderId: string) => {
    try {
      return await fsManager.readFolderMetadata(folderId)
    } catch (error) {
      throw new Error(`Failed to read folder metadata: ${(error as Error).message}`)
    }
  })

  ipcMain.handle(
    'fs:updateFolderMetadata',
    async (_event: IpcMainInvokeEvent, folderId: string, updates: Partial<FolderMetadata>) => {
      try {
        return await fsManager.updateFolderMetadata(folderId, updates)
      } catch (error) {
        throw new Error(`Failed to update folder metadata: ${(error as Error).message}`)
      }
    }
  )

  ipcMain.handle('fs:deleteFolder', async (_event: IpcMainInvokeEvent, folderId: string) => {
    try {
      await fsManager.deleteFolder(folderId)
    } catch (error) {
      throw new Error(`Failed to delete folder: ${(error as Error).message}`)
    }
  })

  ipcMain.handle('fs:getFolderTree', async (_event: IpcMainInvokeEvent) => {
    try {
      return await fsManager.getFolderTree()
    } catch (error) {
      throw new Error(`Failed to get folder tree: ${(error as Error).message}`)
    }
  })

  // Asset operations
  ipcMain.handle(
    'fs:saveAsset',
    async (
      _event: IpcMainInvokeEvent,
      originalName: string,
      buffer: Uint8Array,
      type: 'image' | 'pdf' | 'attachment'
    ) => {
      try {
        return await fsManager.saveAsset(originalName, Buffer.from(buffer), type)
      } catch (error) {
        throw new Error(`Failed to save asset: ${(error as Error).message}`)
      }
    }
  )

  ipcMain.handle(
    'fs:readAsset',
    async (_event: IpcMainInvokeEvent, assetId: string, type: 'image' | 'pdf' | 'attachment') => {
      try {
        const buffer = await fsManager.readAsset(assetId, type)
        return buffer
      } catch (error) {
        throw new Error(`Failed to read asset: ${(error as Error).message}`)
      }
    }
  )

  ipcMain.handle(
    'fs:deleteAsset',
    async (_event: IpcMainInvokeEvent, assetId: string, type: 'image' | 'pdf' | 'attachment') => {
      try {
        await fsManager.deleteAsset(assetId, type)
      } catch (error) {
        throw new Error(`Failed to delete asset: ${(error as Error).message}`)
      }
    }
  )

  // Database path
  ipcMain.handle('fs:getDatabasePath', async (_event: IpcMainInvokeEvent) => {
    try {
      return fsManager.getDatabasePath()
    } catch (error) {
      throw new Error(`Failed to get database path: ${(error as Error).message}`)
    }
  })
}
