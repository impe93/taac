import { basename } from 'node:path'

import type { SerializedEditorState } from 'lexical'

import type { SpaceManager } from '../utils/spaceManager'
import type { FileSystemManager } from '../utils/fileSystem'
import { ObsidianParser } from './parsers/ObsidianParser'
import { AppleNotesParser } from './parsers/AppleNotesParser'
import { JoplinParser } from './parsers/JoplinParser'
import type { BaseParser } from './parsers/BaseParser'
import type {
  ImportSource,
  ImportOptions,
  ImportScanResult,
  ImportResult,
  ImportFileError,
  ImportProgressEvent,
  ParsedNote,
  ParsedAttachment
} from './types'

// ============================================================================
// Asset Type Mapping
// ============================================================================

/**
 * Map ParsedAttachment plural types to FileSystemManager singular types.
 */
function toAssetType(parsed: ParsedAttachment['type']): 'image' | 'pdf' | 'attachment' {
  switch (parsed) {
    case 'images':
      return 'image'
    case 'pdfs':
      return 'pdf'
    case 'attachments':
      return 'attachment'
  }
}

/**
 * Human-readable source label for container folder names.
 */
function sourceLabel(source: ImportSource): string {
  switch (source) {
    case 'apple-notes':
      return 'Apple Notes'
    case 'obsidian':
      return 'Obsidian'
    case 'joplin':
      return 'Joplin'
  }
}

// ============================================================================
// ImportManager
// ============================================================================

/**
 * Singleton orchestrator for the note import pipeline.
 *
 * Coordinates parsing, space/folder creation, attachment copying, and note
 * creation across the ObsidianParser and AppleNotesParser backends.
 *
 * Reference: docs/ONBOARDING_NEW_USER.md Section 4.2
 */
export class ImportManager {
  private static instance: ImportManager | null = null

  private constructor() {
    this.log('ImportManager initialized')
  }

  static getInstance(): ImportManager {
    if (!ImportManager.instance) ImportManager.instance = new ImportManager()
    return ImportManager.instance
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Preview scan — returns metadata about the source without performing a full parse.
   */
  async scan(sourcePath: string, source: ImportSource): Promise<ImportScanResult> {
    const parser = this.getParser(source)
    this.log(`Scanning ${sourceLabel(source)} at ${sourcePath}`)
    return parser.scan(sourcePath)
  }

  /**
   * Check if the Apple Notes SQLite database is accessible.
   * Delegates to AppleNotesParser.checkAccess().
   */
  async checkAppleNotesAccess(): Promise<{ accessible: boolean; dbPath?: string; error?: string }> {
    return AppleNotesParser.checkAccess()
  }

  /**
   * Execute the full import pipeline:
   * 1. Parse source → ParsedNote[]
   * 2. Create or resolve target space
   * 3. Create folder structure depth-first
   * 4. Create notes with attachments
   * 5. Return ImportResult
   */
  async runImport(
    options: ImportOptions,
    spaceManager: SpaceManager,
    getOrCreateFsManager: (spaceId: string) => FileSystemManager,
    onProgress: (event: ImportProgressEvent) => void
  ): Promise<ImportResult> {
    const errors: ImportFileError[] = []
    let importedNotes = 0
    let importedFolders = 0
    let importedAttachments = 0
    let skippedFiles = 0

    // -- Phase 1: Parse source -----------------------------------------------

    onProgress({
      phase: 'scanning',
      current: 0,
      total: 0,
      currentFile: null,
      status: 'in-progress'
    })

    this.log(`Starting import from ${sourceLabel(options.source)}`)

    const parser = this.getParser(options.source)
    let parsedNotes: ParsedNote[]

    try {
      parsedNotes = await parser.parse(options.sourcePath)
    } catch (error) {
      const msg = `Parse failed: ${(error as Error).message}`
      this.log(msg)
      onProgress({
        phase: 'scanning',
        current: 0,
        total: 0,
        currentFile: null,
        status: 'error',
        error: msg
      })
      throw new Error(msg)
    }

    onProgress({
      phase: 'scanning',
      current: parsedNotes.length,
      total: parsedNotes.length,
      currentFile: null,
      status: 'complete'
    })

    this.log(`Parsed ${parsedNotes.length} notes`)

    // -- Phase 2: Create or resolve target space -----------------------------

    let spaceId: string

    if (options.targetMode === 'new-space') {
      const name = options.newSpaceName ?? sourceLabel(options.source)
      const icon = options.newSpaceIcon ?? 'FileText'
      const space = await spaceManager.createSpace(name, icon)
      spaceId = space.id
      this.log(`Created new space "${name}" (${spaceId})`)
    } else {
      if (!options.targetSpaceId) {
        throw new Error('targetSpaceId is required for existing-space mode')
      }
      spaceId = options.targetSpaceId
      this.log(`Using existing space ${spaceId}`)
    }

    const fsManager = getOrCreateFsManager(spaceId)

    // -- Phase 3: Create folder structure ------------------------------------

    onProgress({
      phase: 'converting',
      current: 0,
      total: parsedNotes.length,
      currentFile: null,
      status: 'in-progress'
    })

    const folderPathToIdMap: Record<string, string> = {}

    // For existing-space mode, create a root-level container folder
    let containerFolderId: string | null = null
    if (options.targetMode === 'existing-space') {
      const containerName = sourceLabel(options.source)
      try {
        const folder = await fsManager.createFolder(containerName, 'root')
        containerFolderId = folder.id
        folderPathToIdMap[''] = folder.id
        importedFolders++
        this.log(`Created container folder "${containerName}" (${folder.id})`)
      } catch (error) {
        throw new Error(`Failed to create container folder: ${(error as Error).message}`)
      }
    }

    // Collect and deduplicate all folder paths from parsed notes
    const folderPaths = new Set<string>()
    for (const note of parsedNotes) {
      if (note.folder) folderPaths.add(note.folder)
    }

    // Sort paths so parents come before children (depth-first)
    const sortedPaths = Array.from(folderPaths).sort(
      (a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)
    )

    // Create folders depth-first
    for (const folderPath of sortedPaths) {
      try {
        const segments = folderPath.split('/')
        let currentPath = ''

        for (const segment of segments) {
          const parentPath = currentPath
          currentPath = currentPath ? `${currentPath}/${segment}` : segment

          // Skip if already created
          if (folderPathToIdMap[currentPath]) continue

          // Determine parent folder ID
          let parentId: string
          if (parentPath && folderPathToIdMap[parentPath]) {
            parentId = folderPathToIdMap[parentPath]
          } else if (containerFolderId) {
            parentId = containerFolderId
          } else {
            parentId = 'root'
          }

          const folder = await fsManager.createFolder(segment, parentId)
          folderPathToIdMap[currentPath] = folder.id
          importedFolders++
        }
      } catch (error) {
        const msg = `Failed to create folder "${folderPath}": ${(error as Error).message}`
        this.warn(msg)
        errors.push({ filePath: folderPath, error: msg })
      }
    }

    this.log(`Created ${importedFolders} folders`)

    // -- Phase 4: Create notes -----------------------------------------------

    onProgress({
      phase: 'creating',
      current: 0,
      total: parsedNotes.length,
      currentFile: null,
      status: 'in-progress'
    })

    for (let i = 0; i < parsedNotes.length; i++) {
      const parsed = parsedNotes[i]

      try {
        // Resolve folder ID
        let folderId: string
        if (parsed.folder && folderPathToIdMap[parsed.folder]) {
          folderId = folderPathToIdMap[parsed.folder]
        } else if (containerFolderId) {
          folderId = containerFolderId
        } else {
          folderId = 'root'
        }

        // Copy attachments and build URL mapping
        let content = parsed.content
        for (const attachment of parsed.attachments) {
          try {
            const asset = await fsManager.saveAsset(
              attachment.filename,
              attachment.data,
              toAssetType(attachment.type)
            )

            // Rewrite references in content to taac-asset:// URLs.
            // Canonical format: taac-asset://<spaceId>/<type>/<assetId>.<ext>
            // (see the `taac-asset` protocol handler in src/main/index.ts and
            // FileSystemManager.saveAsset, which stores files as `<assetId>.<ext>`).
            const assetUrl = `taac-asset://${spaceId}/${attachment.type}/${basename(asset.path)}`
            content = this.rewriteAttachmentRef(content, attachment, assetUrl)
            importedAttachments++
          } catch (error) {
            const msg = `Failed to save attachment "${attachment.filename}": ${(error as Error).message}`
            this.warn(msg)
            errors.push({ filePath: attachment.originalPath, error: msg })
          }
        }

        // Create the note
        // Note: content is markdown from parsers; cast to SerializedEditorState
        // for storage. The editor will handle conversion when the note is opened.
        await fsManager.createNote(
          folderId,
          content as unknown as SerializedEditorState,
          parsed.title
        )
        importedNotes++

        onProgress({
          phase: 'creating',
          current: i + 1,
          total: parsedNotes.length,
          currentFile: parsed.title,
          status: 'in-progress'
        })
      } catch (error) {
        const msg = `Failed to import note "${parsed.title}": ${(error as Error).message}`
        this.warn(msg)
        errors.push({ filePath: parsed.title, error: msg })
        skippedFiles++
      }
    }

    // -- Phase 5: Complete ---------------------------------------------------

    this.log(
      `Import complete: ${importedNotes} notes, ${importedFolders} folders, ` +
        `${importedAttachments} attachments, ${skippedFiles} skipped, ${errors.length} errors`
    )

    onProgress({
      phase: 'complete',
      current: parsedNotes.length,
      total: parsedNotes.length,
      currentFile: null,
      status: 'complete'
    })

    return {
      spaceId,
      totalFiles: parsedNotes.length,
      importedNotes,
      importedFolders,
      importedAttachments,
      skippedFiles,
      errors
    }
  }

  // --------------------------------------------------------------------------
  // Private Helpers
  // --------------------------------------------------------------------------

  private getParser(source: ImportSource): BaseParser {
    if (source === 'obsidian') return new ObsidianParser()
    if (source === 'joplin') return new JoplinParser()
    return new AppleNotesParser()
  }

  /**
   * Rewrite attachment references in markdown content to the new asset URL.
   *
   * Handles Obsidian-style embed syntax (already converted to `![name]()`),
   * Apple Notes `(attachment)` placeholders, and Joplin-style markdown links
   * (both image `![alt](path)` and file `[text](path)` forms) where the path is
   * the reference exactly as it appears in the note body.
   */
  private rewriteAttachmentRef(
    content: string,
    attachment: ParsedAttachment,
    assetUrl: string
  ): string {
    const escaped = attachment.filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    // Obsidian: ![filename]() → ![filename](assetUrl)
    const embedPattern = new RegExp(`!\\[${escaped}\\]\\(\\)`, 'g')
    content = content.replace(embedPattern, `![${attachment.filename}](${assetUrl})`)

    // Markdown image references with the original path: ![alt](path) → ![alt](assetUrl)
    const escapedPath = attachment.originalPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const imagePattern = new RegExp(`!\\[([^\\]]*)\\]\\(${escapedPath}\\)`, 'g')
    content = content.replace(imagePattern, `![$1](${assetUrl})`)

    // Markdown file links with the original path: [text](path) → [text](assetUrl)
    // (the leading `!` is excluded so image refs above aren't matched twice)
    const linkPattern = new RegExp(`(^|[^!])\\[([^\\]]*)\\]\\(${escapedPath}\\)`, 'g')
    content = content.replace(linkPattern, `$1[$2](${assetUrl})`)

    return content
  }

  private log(message: string): void {
    console.log(`[ImportManager] ${message}`)
  }

  private warn(message: string): void {
    console.warn(`[ImportManager] ${message}`)
  }
}
