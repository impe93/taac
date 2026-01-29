import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'

export interface Space {
  id: string
  name: string
  icon: string
  createdAt: string
  updatedAt: string
  order: number
}

interface SpacesData {
  spaces: Space[]
}

export class SpaceManager {
  private userDataPath: string
  private spacesDir: string
  private spacesFilePath: string

  constructor() {
    this.userDataPath = app.getPath('userData')
    this.spacesDir = join(this.userDataPath, 'spaces')
    this.spacesFilePath = join(this.spacesDir, 'spaces.json')
  }

  // Initialize spaces directory and metadata file
  async initialize(): Promise<void> {
    await this.ensureDir(this.spacesDir)

    try {
      await fs.access(this.spacesFilePath)
    } catch {
      const initialData: SpacesData = { spaces: [] }
      await fs.writeFile(this.spacesFilePath, JSON.stringify(initialData, null, 2), 'utf-8')
    }
  }

  // Create a new space
  async createSpace(name: string, icon: string): Promise<Space> {
    const spaces = await this.listSpaces()

    // Validate limit of 5 spaces
    if (spaces.length >= 5) {
      throw new Error('Maximum number of spaces (5) reached')
    }

    // Validate name
    if (!name || name.trim().length === 0) {
      throw new Error('Space name cannot be empty')
    }

    if (name.length > 50) {
      throw new Error('Space name cannot exceed 50 characters')
    }

    const spaceId = uuidv4()
    const space: Space = {
      id: spaceId,
      name: name.trim(),
      icon,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      order: spaces.length
    }

    // Create space directory structure
    const spaceDir = join(this.spacesDir, spaceId)
    await this.ensureDir(spaceDir)
    await this.ensureDir(join(spaceDir, 'notes'))
    await this.ensureDir(join(spaceDir, 'assets', 'images'))
    await this.ensureDir(join(spaceDir, 'assets', 'pdfs'))
    await this.ensureDir(join(spaceDir, 'assets', 'attachments'))

    // Initialize FileSystemManager for the new space
    try {
      // Dynamic import to avoid circular dependency
      const { getOrCreateFsManager } = await import('../index')
      const fsManager = getOrCreateFsManager(spaceId)
      await fsManager.initialize()
      console.log(`[SpaceManager] Initialized FileSystemManager for new space: ${spaceId}`)
    } catch (error) {
      console.error(
        `[SpaceManager] Failed to initialize FileSystemManager for space ${spaceId}:`,
        error
      )
      // Don't fail space creation if FileSystemManager init fails
    }

    // Add space to metadata
    spaces.push(space)
    await this.saveSpaces(spaces)

    return space
  }

  // List all spaces
  async listSpaces(): Promise<Space[]> {
    try {
      const data = await fs.readFile(this.spacesFilePath, 'utf-8')
      const spacesData: SpacesData = JSON.parse(data)
      return spacesData.spaces.sort((a, b) => a.order - b.order)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return []
      }
      throw error
    }
  }

  // Get a single space by ID
  async getSpace(spaceId: string): Promise<Space> {
    const spaces = await this.listSpaces()
    const space = spaces.find((s) => s.id === spaceId)

    if (!space) {
      throw new Error(`Space not found: ${spaceId}`)
    }

    return space
  }

  // Update space metadata
  async updateSpace(spaceId: string, updates: Partial<Space>): Promise<Space> {
    const spaces = await this.listSpaces()
    const spaceIndex = spaces.findIndex((s) => s.id === spaceId)

    if (spaceIndex === -1) {
      throw new Error(`Space not found: ${spaceId}`)
    }

    // Validate name if being updated
    if (updates.name !== undefined) {
      if (!updates.name || updates.name.trim().length === 0) {
        throw new Error('Space name cannot be empty')
      }
      if (updates.name.length > 50) {
        throw new Error('Space name cannot exceed 50 characters')
      }
    }

    const updatedSpace = {
      ...spaces[spaceIndex],
      ...updates,
      updatedAt: new Date().toISOString()
    }

    spaces[spaceIndex] = updatedSpace
    await this.saveSpaces(spaces)

    return updatedSpace
  }

  // Delete a space and all its contents
  async deleteSpace(spaceId: string): Promise<void> {
    const spaces = await this.listSpaces()
    const spaceIndex = spaces.findIndex((s) => s.id === spaceId)

    if (spaceIndex === -1) {
      throw new Error(`Space not found: ${spaceId}`)
    }

    // Delete space directory recursively
    const spaceDir = join(this.spacesDir, spaceId)
    try {
      await fs.rm(spaceDir, { recursive: true, force: true })
    } catch (error) {
      console.error(`Failed to delete space directory: ${spaceDir}`, error)
    }

    // Remove from metadata
    spaces.splice(spaceIndex, 1)

    // Reorder remaining spaces
    spaces.forEach((space, index) => {
      space.order = index
    })

    await this.saveSpaces(spaces)
  }

  // Ensure default "Personal" space exists
  async ensureDefaultSpace(): Promise<Space> {
    const spaces = await this.listSpaces()

    if (spaces.length === 0) {
      return this.createSpace('Personal', 'Home')
    }

    return spaces[0]
  }

  // Private helper: ensure directory exists
  private async ensureDir(dirPath: string): Promise<void> {
    try {
      await fs.access(dirPath)
    } catch {
      await fs.mkdir(dirPath, { recursive: true })
    }
  }

  // Private helper: save spaces to file
  private async saveSpaces(spaces: Space[]): Promise<void> {
    const spacesData: SpacesData = { spaces }
    await fs.writeFile(this.spacesFilePath, JSON.stringify(spacesData, null, 2), 'utf-8')
  }
}
