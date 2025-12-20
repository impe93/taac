import { app } from 'electron'
import { promises as fs } from 'fs'
import { join, resolve, normalize } from 'path'
import { v4 as uuidv4 } from 'uuid'
import type { SerializedEditorState } from 'lexical'

// Type definitions
export interface Note {
  id: string
  folderId: string
  content: SerializedEditorState
  createdAt: string
  updatedAt: string
  title: string
}

export interface FolderMetadata {
  id: string
  name: string
  parentId: string | null
  children: string[]
  createdAt: string
  updatedAt: string
  noteIds: string[]
}

export interface Asset {
  id: string
  originalName: string
  type: 'image' | 'pdf' | 'attachment'
  path: string
  size: number
  createdAt: string
}

// File System Manager
export class FileSystemManager {
  private userDataPath: string
  private spaceId: string

  constructor(spaceId: string) {
    this.spaceId = spaceId
    this.userDataPath = join(app.getPath('userData'), 'spaces', spaceId)
  }

  // Get space ID
  getSpaceId(): string {
    return this.spaceId
  }

  // Base path getters
  private getBasePath(type: 'notes' | 'assets' | 'database' | 'config'): string {
    return join(this.userDataPath, type)
  }

  // Path validation - prevents directory traversal attacks
  private validatePath(requestedPath: string, allowedBase: string): string {
    const normalized = normalize(requestedPath)
    const resolved = resolve(allowedBase, normalized)

    if (!resolved.startsWith(allowedBase)) {
      throw new Error('Invalid path: directory traversal detected')
    }

    return resolved
  }

  // Ensure directory exists
  private async ensureDir(dirPath: string): Promise<void> {
    try {
      await fs.access(dirPath)
    } catch {
      await fs.mkdir(dirPath, { recursive: true })
    }
  }

  // Initialize file structure
  async initialize(): Promise<void> {
    const dirs = [
      join(this.userDataPath, 'notes'),
      join(this.userDataPath, 'assets', 'images'),
      join(this.userDataPath, 'assets', 'pdfs'),
      join(this.userDataPath, 'assets', 'attachments'),
      join(this.userDataPath, 'database'),
      join(this.userDataPath, 'config'),
      join(this.userDataPath, 'logs')
    ]

    for (const dir of dirs) {
      await this.ensureDir(dir)
    }

    // Initialize root metadata if it doesn't exist
    const rootMetaPath = join(this.getBasePath('notes'), 'metadata.json')
    try {
      await fs.access(rootMetaPath)
    } catch {
      const rootMeta: FolderMetadata = {
        id: 'root',
        name: 'Root',
        parentId: null,
        children: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        noteIds: []
      }
      await fs.writeFile(rootMetaPath, JSON.stringify(rootMeta, null, 2), 'utf-8')
    }
  }

  // Note operations
  async createNote(folderId: string, content: SerializedEditorState, title: string): Promise<Note> {
    const noteId = uuidv4()
    const note: Note = {
      id: noteId,
      folderId,
      content,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      title
    }

    const folderPath = join(this.getBasePath('notes'), folderId)
    await this.ensureDir(folderPath)

    const notePath = this.validatePath(
      join(folderPath, `${noteId}.json`),
      this.getBasePath('notes')
    )

    await fs.writeFile(notePath, JSON.stringify(note, null, 2), 'utf-8')

    // Update folder metadata
    await this.addNoteToFolder(folderId, noteId)

    return note
  }

  async readNote(folderId: string, noteId: string): Promise<Note> {
    const notePath = this.validatePath(
      join(this.getBasePath('notes'), folderId, `${noteId}.json`),
      this.getBasePath('notes')
    )

    const data = await fs.readFile(notePath, 'utf-8')
    return JSON.parse(data) as Note
  }

  async updateNote(folderId: string, noteId: string, updates: Partial<Note>): Promise<Note> {
    const note = await this.readNote(folderId, noteId)
    const updated = {
      ...note,
      ...updates,
      updatedAt: new Date().toISOString()
    }

    const notePath = this.validatePath(
      join(this.getBasePath('notes'), folderId, `${noteId}.json`),
      this.getBasePath('notes')
    )

    await fs.writeFile(notePath, JSON.stringify(updated, null, 2), 'utf-8')
    return updated
  }

  async deleteNote(folderId: string, noteId: string): Promise<void> {
    const notePath = this.validatePath(
      join(this.getBasePath('notes'), folderId, `${noteId}.json`),
      this.getBasePath('notes')
    )

    await fs.unlink(notePath)
    await this.removeNoteFromFolder(folderId, noteId)
  }

  async listNotes(folderId: string): Promise<Note[]> {
    const folderPath = join(this.getBasePath('notes'), folderId)

    try {
      const files = await fs.readdir(folderPath)
      const noteFiles = files.filter((f) => f.endsWith('.json') && f !== 'metadata.json')

      const notes = await Promise.all(
        noteFiles.map(async (file) => {
          const noteId = file.replace('.json', '')
          return this.readNote(folderId, noteId)
        })
      )

      return notes
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return []
      }
      throw error
    }
  }

  // Folder operations
  async createFolder(name: string, parentId: string = 'root'): Promise<FolderMetadata> {
    const folderId = uuidv4()
    const folderMeta: FolderMetadata = {
      id: folderId,
      name,
      parentId,
      children: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      noteIds: []
    }

    const folderPath = join(this.getBasePath('notes'), folderId)
    await this.ensureDir(folderPath)

    const metaPath = join(folderPath, 'metadata.json')
    await fs.writeFile(metaPath, JSON.stringify(folderMeta, null, 2), 'utf-8')

    // Update parent folder
    await this.addChildToFolder(parentId, folderId)

    return folderMeta
  }

  async readFolderMetadata(folderId: string): Promise<FolderMetadata> {
    const metaPath = this.validatePath(
      join(this.getBasePath('notes'), folderId, 'metadata.json'),
      this.getBasePath('notes')
    )

    const data = await fs.readFile(metaPath, 'utf-8')
    return JSON.parse(data) as FolderMetadata
  }

  async updateFolderMetadata(
    folderId: string,
    updates: Partial<FolderMetadata>
  ): Promise<FolderMetadata> {
    const meta = await this.readFolderMetadata(folderId)
    const updated = {
      ...meta,
      ...updates,
      updatedAt: new Date().toISOString()
    }

    const metaPath = this.validatePath(
      join(this.getBasePath('notes'), folderId, 'metadata.json'),
      this.getBasePath('notes')
    )

    await fs.writeFile(metaPath, JSON.stringify(updated, null, 2), 'utf-8')
    return updated
  }

  async deleteFolder(folderId: string): Promise<void> {
    // Recursive delete
    const meta = await this.readFolderMetadata(folderId)

    // Delete child folders first
    for (const childId of meta.children) {
      await this.deleteFolder(childId)
    }

    // Delete all notes in folder
    for (const noteId of meta.noteIds) {
      await this.deleteNote(folderId, noteId)
    }

    // Delete folder directory
    const folderPath = this.validatePath(
      join(this.getBasePath('notes'), folderId),
      this.getBasePath('notes')
    )
    await fs.rm(folderPath, { recursive: true })

    // Remove from parent
    if (meta.parentId) {
      await this.removeChildFromFolder(meta.parentId, folderId)
    }
  }

  async getFolderTree(): Promise<FolderMetadata> {
    return this.readFolderMetadata('root')
  }

  private async addNoteToFolder(folderId: string, noteId: string): Promise<void> {
    const meta = await this.readFolderMetadata(folderId)
    if (!meta.noteIds.includes(noteId)) {
      meta.noteIds.push(noteId)
      await this.updateFolderMetadata(folderId, { noteIds: meta.noteIds })
    }
  }

  private async removeNoteFromFolder(folderId: string, noteId: string): Promise<void> {
    const meta = await this.readFolderMetadata(folderId)
    meta.noteIds = meta.noteIds.filter((id) => id !== noteId)
    await this.updateFolderMetadata(folderId, { noteIds: meta.noteIds })
  }

  private async addChildToFolder(parentId: string, childId: string): Promise<void> {
    const meta = await this.readFolderMetadata(parentId)
    if (!meta.children.includes(childId)) {
      meta.children.push(childId)
      await this.updateFolderMetadata(parentId, { children: meta.children })
    }
  }

  private async removeChildFromFolder(parentId: string, childId: string): Promise<void> {
    const meta = await this.readFolderMetadata(parentId)
    meta.children = meta.children.filter((id) => id !== childId)
    await this.updateFolderMetadata(parentId, { children: meta.children })
  }

  // Asset operations
  async saveAsset(
    originalName: string,
    buffer: Buffer,
    type: 'image' | 'pdf' | 'attachment'
  ): Promise<Asset> {
    const assetId = uuidv4()
    const ext = originalName.split('.').pop() || ''
    const filename = `${assetId}.${ext}`

    const assetDir = join(this.getBasePath('assets'), `${type}s`)
    await this.ensureDir(assetDir)

    const assetPath = join(assetDir, filename)
    await fs.writeFile(assetPath, buffer)

    const asset: Asset = {
      id: assetId,
      originalName,
      type,
      path: assetPath,
      size: buffer.length,
      createdAt: new Date().toISOString()
    }

    return asset
  }

  async readAsset(assetId: string, type: 'image' | 'pdf' | 'attachment'): Promise<Buffer> {
    const assetDir = join(this.getBasePath('assets'), `${type}s`)
    const files = await fs.readdir(assetDir)
    const assetFile = files.find((f) => f.startsWith(assetId))

    if (!assetFile) {
      throw new Error(`Asset not found: ${assetId}`)
    }

    const assetPath = this.validatePath(join(assetDir, assetFile), this.getBasePath('assets'))

    return fs.readFile(assetPath)
  }

  async deleteAsset(assetId: string, type: 'image' | 'pdf' | 'attachment'): Promise<void> {
    const assetDir = join(this.getBasePath('assets'), `${type}s`)
    const files = await fs.readdir(assetDir)
    const assetFile = files.find((f) => f.startsWith(assetId))

    if (!assetFile) {
      throw new Error(`Asset not found: ${assetId}`)
    }

    const assetPath = this.validatePath(join(assetDir, assetFile), this.getBasePath('assets'))

    await fs.unlink(assetPath)
  }

  // Database path getter
  getDatabasePath(): string {
    return join(this.getBasePath('database'), 'vectors.db')
  }
}
