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

export interface MoveFolderToSpaceResult {
  folders: Record<string, FolderMetadata>
  notes: Record<string, Note>
  topFolderId: string
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

  // Check if file exists
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }

  // Migrate root structure from old location to new location
  private async migrateRootStructure(): Promise<void> {
    const oldPath = join(this.getBasePath('notes'), 'metadata.json')
    const newPath = join(this.getBasePath('notes'), 'root', 'metadata.json')

    // If old file exists and new file doesn't exist, migrate
    if ((await this.fileExists(oldPath)) && !(await this.fileExists(newPath))) {
      await this.ensureDir(join(this.getBasePath('notes'), 'root'))
      await fs.rename(oldPath, newPath)
      console.log(`[FileSystemManager] Migrated root metadata for space ${this.spaceId}`)
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

    // Migrate root structure from old location if needed
    await this.migrateRootStructure()

    // Ensure root directory exists
    await this.ensureDir(join(this.getBasePath('notes'), 'root'))

    // Initialize root metadata if it doesn't exist
    const rootMetaPath = join(this.getBasePath('notes'), 'root', 'metadata.json')
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

  /**
   * Reconstruct the full folder path by walking up the parentId chain.
   * Returns "Parent / Child / Grandchild" or undefined for root-level notes.
   */
  async getFullFolderPath(folderId: string): Promise<string | undefined> {
    if (folderId === 'root') return undefined
    const parts: string[] = []
    let currentId: string | null = folderId
    while (currentId && currentId !== 'root') {
      const meta = await this.readFolderMetadata(currentId)
      if (!meta || meta.id === 'root') break
      parts.unshift(meta.name)
      currentId = meta.parentId
    }
    return parts.length > 0 ? parts.join(' / ') : undefined
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

  // Move operations
  async moveNote(noteId: string, sourceFolderId: string, targetFolderId: string): Promise<Note> {
    // 1. VALIDATION
    if (sourceFolderId === targetFolderId) {
      throw new Error('Source and target folders are the same')
    }

    // 2. READ NOTE DATA
    const note = await this.readNote(sourceFolderId, noteId)

    // 3. CONSTRUCT PATHS
    const sourcePath = this.validatePath(
      join(this.getBasePath('notes'), sourceFolderId, `${noteId}.json`),
      this.getBasePath('notes')
    )

    const targetFolderPath = join(this.getBasePath('notes'), targetFolderId)
    await this.ensureDir(targetFolderPath)

    const targetPath = this.validatePath(
      join(targetFolderPath, `${noteId}.json`),
      this.getBasePath('notes')
    )

    // 4. ATOMIC MOVE: File System Operation
    try {
      // Move file atomically
      await fs.rename(sourcePath, targetPath)

      // 5. UPDATE NOTE METADATA
      const updatedNote: Note = {
        ...note,
        folderId: targetFolderId,
        updatedAt: new Date().toISOString()
      }

      // Write updated metadata to new location
      await fs.writeFile(targetPath, JSON.stringify(updatedNote, null, 2), 'utf-8')

      // 6. UPDATE SOURCE FOLDER METADATA (remove noteId)
      await this.removeNoteFromFolder(sourceFolderId, noteId)

      // 7. UPDATE TARGET FOLDER METADATA (add noteId)
      await this.addNoteToFolder(targetFolderId, noteId)

      return updatedNote
    } catch (error) {
      // ROLLBACK: If any step fails, attempt to restore
      try {
        if (await this.fileExists(targetPath)) {
          await fs.rename(targetPath, sourcePath)
        }
      } catch (rollbackError) {
        console.error('CRITICAL: Rollback failed:', rollbackError)
      }

      throw new Error(`Failed to move note: ${(error as Error).message}`)
    }
  }

  async moveFolder(folderId: string, targetParentId: string): Promise<FolderMetadata> {
    // 1. VALIDATION
    if (folderId === 'root') {
      throw new Error('Cannot move root folder')
    }

    if (folderId === targetParentId) {
      throw new Error('Cannot move folder into itself')
    }

    // 2. LOAD FOLDER METADATA
    const folderMeta = await this.readFolderMetadata(folderId)
    const currentParentId = folderMeta.parentId

    if (currentParentId === targetParentId) {
      throw new Error('Folder is already in target parent')
    }

    // 3. CHECK FOR CIRCULAR DEPENDENCY
    await this.validateNoCircularDependency(folderId, targetParentId)

    // 4. UPDATE FOLDER METADATA
    const updatedFolder: FolderMetadata = {
      ...folderMeta,
      parentId: targetParentId,
      updatedAt: new Date().toISOString()
    }

    try {
      // 5. WRITE UPDATED METADATA
      const metaPath = this.validatePath(
        join(this.getBasePath('notes'), folderId, 'metadata.json'),
        this.getBasePath('notes')
      )
      await fs.writeFile(metaPath, JSON.stringify(updatedFolder, null, 2), 'utf-8')

      // 6. UPDATE OLD PARENT (remove from children)
      if (currentParentId) {
        await this.removeChildFromFolder(currentParentId, folderId)
      }

      // 7. UPDATE NEW PARENT (add to children)
      await this.addChildToFolder(targetParentId, folderId)

      return updatedFolder
    } catch (error) {
      // ROLLBACK: Restore original metadata
      try {
        const metaPath = this.validatePath(
          join(this.getBasePath('notes'), folderId, 'metadata.json'),
          this.getBasePath('notes')
        )
        await fs.writeFile(metaPath, JSON.stringify(folderMeta, null, 2), 'utf-8')

        // Restore parent relationships
        if (currentParentId) {
          await this.addChildToFolder(currentParentId, folderId)
        }
        await this.removeChildFromFolder(targetParentId, folderId)
      } catch (rollbackError) {
        console.error('CRITICAL: Rollback failed:', rollbackError)
      }

      throw new Error(`Failed to move folder: ${(error as Error).message}`)
    }
  }

  private async validateNoCircularDependency(
    folderId: string,
    targetParentId: string
  ): Promise<void> {
    let currentId: string | null = targetParentId

    while (currentId !== null) {
      if (currentId === folderId) {
        throw new Error('Cannot move folder into its own descendant')
      }

      const parentMeta = await this.readFolderMetadata(currentId)
      currentId = parentMeta.parentId
    }
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

  // ============================================================================
  // CROSS-SPACE MOVE OPERATIONS
  // ============================================================================

  /**
   * Extract asset URLs from Lexical editor content
   * Matches pattern: taac-asset://spaceId/type/assetId.ext
   */
  extractAssetUrls(content: SerializedEditorState): string[] {
    const urls: string[] = []
    const contentStr = JSON.stringify(content)

    // Match taac-asset:// URLs
    const regex = /taac-asset:\/\/([^/]+)\/([^/]+)\/([^"\\]+)/g
    let match

    while ((match = regex.exec(contentStr)) !== null) {
      urls.push(match[0])
    }

    return [...new Set(urls)] // Remove duplicates
  }

  /**
   * Rewrite asset URLs in content from source space to target space
   */
  rewriteAssetUrls(
    content: SerializedEditorState,
    sourceSpaceId: string,
    targetSpaceId: string
  ): SerializedEditorState {
    const contentStr = JSON.stringify(content)
    const rewritten = contentStr.replace(
      new RegExp(`taac-asset://${sourceSpaceId}/`, 'g'),
      `taac-asset://${targetSpaceId}/`
    )
    return JSON.parse(rewritten)
  }

  /**
   * Copy an asset from this space to the target space
   * @param targetFsManager FileSystemManager instance for target space
   * @param assetUrl Full taac-asset:// URL
   * @returns The new asset URL in target space
   */
  async copyAssetToSpace(targetFsManager: FileSystemManager, assetUrl: string): Promise<string> {
    // Parse URL: taac-asset://spaceId/type/assetId.ext
    const urlMatch = assetUrl.match(/taac-asset:\/\/([^/]+)\/([^/]+)\/(.+)/)
    if (!urlMatch) {
      throw new Error(`Invalid asset URL: ${assetUrl}`)
    }

    const [, , typeStr, filename] = urlMatch
    const type = typeStr.replace(/s$/, '') as 'image' | 'pdf' | 'attachment' // Remove trailing 's'
    const assetId = filename.split('.')[0]

    // Read asset from source space
    const buffer = await this.readAsset(assetId, type)

    // Save to target space (will generate new ID but we keep same extension)
    const ext = filename.split('.').pop() || ''
    const newAsset = await targetFsManager.saveAsset(`asset.${ext}`, buffer, type)

    // Return new URL
    return `taac-asset://${targetFsManager.getSpaceId()}/${type}s/${newAsset.id}.${ext}`
  }

  /**
   * Move a note from this space to another space
   * Handles asset copying and URL rewriting
   * @param targetFsManager FileSystemManager instance for target space
   * @param noteId ID of the note to move
   * @param sourceFolderId Current folder ID of the note
   * @returns The moved note in target space
   */
  async moveNoteToSpace(
    targetFsManager: FileSystemManager,
    noteId: string,
    sourceFolderId: string
  ): Promise<Note> {
    // 1. Read note from source space
    const note = await this.readNote(sourceFolderId, noteId)

    // 2. Extract and copy assets
    const assetUrls = this.extractAssetUrls(note.content)
    const assetMap = new Map<string, string>() // oldUrl -> newUrl

    for (const url of assetUrls) {
      try {
        const newUrl = await this.copyAssetToSpace(targetFsManager, url)
        assetMap.set(url, newUrl)
      } catch (error) {
        console.warn(`Failed to copy asset ${url}:`, error)
        // Continue - asset might not exist anymore
      }
    }

    // 3. Rewrite content with new asset URLs
    let newContent = note.content
    if (assetMap.size > 0) {
      let contentStr = JSON.stringify(newContent)
      assetMap.forEach((newUrl, oldUrl) => {
        contentStr = contentStr.split(oldUrl).join(newUrl)
      })
      newContent = JSON.parse(contentStr)
    }

    // 4. Create note in target space (root folder)
    const targetNote = await targetFsManager.createNote('root', newContent, note.title)

    // 5. Delete note from source space
    await this.deleteNote(sourceFolderId, noteId)

    return targetNote
  }

  /**
   * Recursively collect all folder IDs and note IDs in a subtree
   */
  private async collectSubtree(
    folderId: string
  ): Promise<{ folderIds: string[]; noteData: Array<{ noteId: string; folderId: string }> }> {
    const folder = await this.readFolderMetadata(folderId)
    const folderIds: string[] = [folderId]
    const noteData: Array<{ noteId: string; folderId: string }> = []

    // Collect notes in this folder
    for (const noteId of folder.noteIds) {
      noteData.push({ noteId, folderId })
    }

    // Recursively collect from child folders
    for (const childId of folder.children) {
      const childData = await this.collectSubtree(childId)
      folderIds.push(...childData.folderIds)
      noteData.push(...childData.noteData)
    }

    return { folderIds, noteData }
  }

  /**
   * Move a folder and all its contents to another space
   * Creates the folder structure in target space root
   * @param targetFsManager FileSystemManager instance for target space
   * @param folderId ID of the folder to move
   * @returns All created folders and notes in target space
   */
  async moveFolderToSpace(
    targetFsManager: FileSystemManager,
    folderId: string
  ): Promise<MoveFolderToSpaceResult> {
    if (folderId === 'root') {
      throw new Error('Cannot move root folder')
    }

    // 1. Collect entire subtree structure
    const { folderIds, noteData } = await this.collectSubtree(folderId)

    // 2. Build folder ID mapping (old -> new) and create folders in target
    const folderIdMap = new Map<string, string>()
    const createdFolders: Record<string, FolderMetadata> = {}
    const createdNotes: Record<string, Note> = {}

    // Create folders in topological order (parents before children)
    for (const srcFolderId of folderIds) {
      const srcMeta = await this.readFolderMetadata(srcFolderId)

      // Determine parent in target space
      let targetParentId: string
      if (srcFolderId === folderId) {
        // Top-level folder goes to root
        targetParentId = 'root'
      } else {
        // Child folders use mapped parent ID
        targetParentId = folderIdMap.get(srcMeta.parentId!)!
      }

      const newFolder = await targetFsManager.createFolder(srcMeta.name, targetParentId)
      folderIdMap.set(srcFolderId, newFolder.id)
      createdFolders[newFolder.id] = newFolder
    }

    // 3. Move notes with asset handling
    for (const { noteId, folderId: srcNoteFolder } of noteData) {
      const note = await this.readNote(srcNoteFolder, noteId)

      // Extract and copy assets
      const assetUrls = this.extractAssetUrls(note.content)
      const assetMap = new Map<string, string>()

      for (const url of assetUrls) {
        try {
          const newUrl = await this.copyAssetToSpace(targetFsManager, url)
          assetMap.set(url, newUrl)
        } catch (error) {
          console.warn(`Failed to copy asset ${url}:`, error)
        }
      }

      // Rewrite content with new asset URLs
      let newContent = note.content
      if (assetMap.size > 0) {
        let contentStr = JSON.stringify(newContent)
        assetMap.forEach((newUrl, oldUrl) => {
          contentStr = contentStr.split(oldUrl).join(newUrl)
        })
        newContent = JSON.parse(contentStr)
      }

      // Create note in corresponding target folder
      const targetFolderId = folderIdMap.get(srcNoteFolder)!
      const newNote = await targetFsManager.createNote(targetFolderId, newContent, note.title)
      createdNotes[newNote.id] = newNote
    }

    // 4. Re-read all folders to get updated metadata (with correct noteIds and children)
    for (const newFolderId of Object.keys(createdFolders)) {
      createdFolders[newFolderId] = await targetFsManager.readFolderMetadata(newFolderId)
    }

    // 5. Delete entire source folder tree
    await this.deleteFolder(folderId)

    // 6. Return all created folders and notes
    const topFolderId = folderIdMap.get(folderId)!
    return {
      folders: createdFolders,
      notes: createdNotes,
      topFolderId
    }
  }
}
