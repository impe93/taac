import { promises as fs, constants as fsConstants } from 'fs'
import { join, basename, extname, dirname, relative } from 'path'
import { homedir } from 'os'
import { gunzipSync } from 'zlib'

import Database from 'better-sqlite3'
import protobuf from 'protobufjs'
import TurndownService from 'turndown'

import { BaseParser } from './BaseParser'
import type { ImportScanResult, ParsedNote, ParsedAttachment } from '../types'

// ============================================================================
// Constants
// ============================================================================

const APPLE_EPOCH_OFFSET = 978307200

const NOTES_CONTAINER = join(homedir(), 'Library/Group Containers/group.com.apple.notes')

const DB_PATH = join(NOTES_CONTAINER, 'NoteStore.sqlite')

const OBJECT_REPLACEMENT_CHAR = '\uFFFC'

// ============================================================================
// Internal Types
// ============================================================================

interface AppleNoteRow {
  Z_PK: number
  ZTITLE1: string | null
  ZCREATIONDATE1: number | null
  ZMODIFICATIONDATE1: number | null
  ZFOLDER: number | null
  ZACCOUNT: number | null
  folderName: string | null
}

interface AppleNoteFolderRow {
  Z_PK: number
  ZTITLE2: string | null
  ZPARENT: number | null
}

interface AppleNoteDataRow {
  ZDATA: Buffer | null
}

interface AppleNoteAttachmentRow {
  Z_PK: number
  ZIDENTIFIER: string
  ZMEDIA: number | null
  ZTYPEUTI: string | null
}

interface AppleNoteMediaRow {
  Z_PK: number
  ZFILENAME: string | null
  ZIDENTIFIER: string | null
}

interface AppleNoteAccountRow {
  Z_PK: number
  ZIDENTIFIER: string | null
}

interface FallbackFile {
  absolutePath: string
  relativePath: string
  isHtml: boolean
}

interface EntityKeys {
  ICNote: number
  ICFolder: number
  ICAccount: number
  ICAttachment: number
  ICMedia: number
}

// ============================================================================
// Style Constants (from reverse-engineered protobuf schema)
// ============================================================================

const enum StyleType {
  Title = 0,
  Heading = 1,
  Subheading = 2,
  Monospaced = 4,
  DottedList = 100,
  DashedList = 101,
  NumberedList = 102,
  Checkbox = 103
}

const enum FontWeight {
  Regular = 0,
  Bold = 1,
  Italic = 2,
  BoldItalic = 3
}

// ============================================================================
// Protobuf Descriptor (reverse-engineered Apple Notes schema)
// MIT License — Copyright (c) 2019 Three Planets Software
// Source: https://github.com/obsidianmd/obsidian-importer
// ============================================================================

const PROTOBUF_DESCRIPTOR = {
  nested: {
    ciofecaforensics: {
      nested: {
        AttachmentInfo: {
          fields: {
            attachmentIdentifier: { type: 'string', id: 1 },
            typeUti: { type: 'string', id: 2 }
          }
        },
        Font: {
          fields: {
            fontName: { type: 'string', id: 1 },
            pointSize: { type: 'float', id: 2 },
            fontHints: { type: 'int32', id: 3 }
          }
        },
        ParagraphStyle: {
          fields: {
            styleType: { type: 'int32', id: 1, options: { default: -1 } },
            alignment: { type: 'int32', id: 2 },
            indentAmount: { type: 'int32', id: 4 },
            checklist: { type: 'Checklist', id: 5 },
            blockquote: { type: 'int32', id: 8 }
          }
        },
        Checklist: {
          fields: {
            uuid: { type: 'bytes', id: 1 },
            done: { type: 'int32', id: 2 }
          }
        },
        AttributeRun: {
          fields: {
            length: { type: 'int32', id: 1 },
            paragraphStyle: { type: 'ParagraphStyle', id: 2 },
            font: { type: 'Font', id: 3 },
            fontWeight: { type: 'int32', id: 5 },
            underlined: { type: 'int32', id: 6 },
            strikethrough: { type: 'int32', id: 7 },
            superscript: { type: 'int32', id: 8 },
            link: { type: 'string', id: 9 },
            attachmentInfo: { type: 'AttachmentInfo', id: 12 }
          }
        },
        NoteStoreProto: {
          fields: {
            document: { type: 'Document', id: 2 }
          }
        },
        Document: {
          fields: {
            version: { type: 'int32', id: 2 },
            note: { type: 'Note', id: 3 }
          }
        },
        Note: {
          fields: {
            noteText: { type: 'string', id: 2 },
            attributeRun: {
              rule: 'repeated',
              type: 'AttributeRun',
              id: 5,
              options: { packed: false }
            }
          }
        }
      }
    }
  }
}

// ============================================================================
// Pure Helper Functions
// ============================================================================

function convertAppleDate(timestamp: number | null): string | undefined {
  if (timestamp == null) return undefined
  return new Date((timestamp + APPLE_EPOCH_OFFSET) * 1000).toISOString()
}

function isGzipData(data: Buffer): boolean {
  return data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b
}

function decompressData(data: Buffer): Buffer {
  if (isGzipData(data)) {
    return gunzipSync(data)
  }
  return data
}

function extractHtmlTitle(html: string): string | null {
  const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i)
  if (titleMatch) {
    const title = titleMatch[1].trim()
    if (title.length > 0) return title
  }

  const h1Match = html.match(/<h1[^>]*>(.*?)<\/h1>/i)
  if (h1Match) {
    const heading = h1Match[1].replace(/<[^>]+>/g, '').trim()
    if (heading.length > 0) return heading
  }

  return null
}

// ============================================================================
// AppleNotesParser
// ============================================================================

export class AppleNotesParser extends BaseParser {
  private protobufRoot: protobuf.Root | null = null

  // --------------------------------------------------------------------------
  // Static: Permission Check
  // --------------------------------------------------------------------------

  static async checkAccess(): Promise<{ accessible: boolean; dbPath?: string; error?: string }> {
    try {
      await fs.access(DB_PATH, fsConstants.R_OK)
      return { accessible: true, dbPath: DB_PATH }
    } catch {
      return {
        accessible: false,
        error:
          'Full Disk Access is required to read Apple Notes. ' +
          'Go to System Settings > Privacy & Security > Full Disk Access ' +
          'and enable TaacNotes.'
      }
    }
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  async scan(sourcePath: string): Promise<ImportScanResult> {
    if (this.isDatabasePath(sourcePath)) {
      return this.scanDatabase(sourcePath)
    }
    return this.scanFallbackDirectory(sourcePath)
  }

  async parse(sourcePath: string): Promise<ParsedNote[]> {
    if (this.isDatabasePath(sourcePath)) {
      return this.parseDatabase(sourcePath)
    }
    return this.parseFallbackDirectory(sourcePath)
  }

  // --------------------------------------------------------------------------
  // Database Mode: Scan
  // --------------------------------------------------------------------------

  private async scanDatabase(dbPath: string): Promise<ImportScanResult> {
    const warnings: string[] = []
    let db: InstanceType<typeof Database> | null = null

    try {
      db = new Database(dbPath, { readonly: true })

      const keys = this.buildEntityKeys(db)
      const trashIds = this.buildTrashFolderIds(db, keys)
      const trashPlaceholders = trashIds.length > 0 ? trashIds.join(',') : '-1'

      const folders = db
        .prepare(
          `SELECT Z_PK, ZTITLE2 FROM ZICCLOUDSYNCINGOBJECT
           WHERE Z_ENT = ${keys.ICFolder}
             AND ZTITLE2 IS NOT NULL
             AND ZFOLDERTYPE != 1`
        )
        .all() as AppleNoteFolderRow[]

      const folderNames = folders
        .map((f) => f.ZTITLE2)
        .filter((name): name is string => name != null)
        .sort()

      const notes = db
        .prepare(
          `SELECT Z_PK, ZTITLE1 FROM ZICCLOUDSYNCINGOBJECT
           WHERE Z_ENT = ${keys.ICNote}
             AND ZTITLE1 IS NOT NULL
             AND ZFOLDER NOT IN (${trashPlaceholders})
             AND (ZISPASSWORDPROTECTED IS NULL OR ZISPASSWORDPROTECTED = 0)`
        )
        .all() as AppleNoteRow[]

      const sampleTitles = notes
        .slice(0, 10)
        .map((n) => n.ZTITLE1)
        .filter((t): t is string => t != null)

      // Estimate total size from ZICNOTEDATA
      const sizeRow = db
        .prepare(`SELECT SUM(LENGTH(ZDATA)) as totalSize FROM ZICNOTEDATA`)
        .get() as { totalSize: number | null } | undefined

      const totalSizeBytes = sizeRow?.totalSize ?? 0

      // Check for attachments
      const attachmentRow = db
        .prepare(
          `SELECT COUNT(*) as cnt FROM ZICCLOUDSYNCINGOBJECT
           WHERE Z_ENT = ${keys.ICAttachment}`
        )
        .get() as { cnt: number } | undefined

      const hasAttachments = (attachmentRow?.cnt ?? 0) > 0

      this.log(`Scan complete: ${notes.length} notes, ${folderNames.length} folders`)

      return {
        source: 'apple-notes',
        totalFiles: notes.length,
        folders: folderNames,
        sampleTitles,
        totalSizeBytes,
        hasAttachments,
        warnings
      }
    } catch (error) {
      const msg = `Failed to scan Apple Notes database: ${(error as Error).message}`
      this.warn(msg)
      warnings.push(msg)

      return {
        source: 'apple-notes',
        totalFiles: 0,
        folders: [],
        sampleTitles: [],
        totalSizeBytes: 0,
        hasAttachments: false,
        warnings
      }
    } finally {
      db?.close()
    }
  }

  // --------------------------------------------------------------------------
  // Database Mode: Parse
  // --------------------------------------------------------------------------

  private async parseDatabase(dbPath: string): Promise<ParsedNote[]> {
    let db: InstanceType<typeof Database> | null = null

    try {
      db = new Database(dbPath, { readonly: true })

      const keys = this.buildEntityKeys(db)
      const trashIds = this.buildTrashFolderIds(db, keys)
      const trashPlaceholders = trashIds.length > 0 ? trashIds.join(',') : '-1'

      // Build folder hierarchy
      const folderMap = this.buildFolderMap(db, keys)

      // Build account map for attachment paths
      const accountMap = this.buildAccountMap(db, keys)

      // Query all notes with their folder names
      const notes = db
        .prepare(
          `SELECT n.Z_PK, n.ZTITLE1, n.ZCREATIONDATE1, n.ZMODIFICATIONDATE1,
                  n.ZFOLDER, n.ZACCOUNT,
                  f.ZTITLE2 as folderName
           FROM ZICCLOUDSYNCINGOBJECT n
           LEFT JOIN ZICCLOUDSYNCINGOBJECT f ON n.ZFOLDER = f.Z_PK
           WHERE n.Z_ENT = ${keys.ICNote}
             AND n.ZTITLE1 IS NOT NULL
             AND n.ZFOLDER NOT IN (${trashPlaceholders})
             AND (n.ZISPASSWORDPROTECTED IS NULL OR n.ZISPASSWORDPROTECTED = 0)`
        )
        .all() as AppleNoteRow[]

      const results: ParsedNote[] = []

      for (const note of notes) {
        try {
          const parsed = await this.parseNote(db, note, folderMap, accountMap)
          if (parsed) results.push(parsed)
        } catch (error) {
          this.warn(
            `Failed to parse note "${note.ZTITLE1 ?? 'Untitled'}": ${(error as Error).message}`
          )
        }
      }

      this.log(`Parsed ${results.length}/${notes.length} notes`)
      return results
    } catch (error) {
      this.warn(`Failed to parse Apple Notes database: ${(error as Error).message}`)
      return []
    } finally {
      db?.close()
    }
  }

  private async parseNote(
    db: InstanceType<typeof Database>,
    note: AppleNoteRow,
    folderMap: Map<number, string>,
    accountMap: Map<number, string>
  ): Promise<ParsedNote | null> {
    // Get the note body data
    const dataRow = db.prepare(`SELECT ZDATA FROM ZICNOTEDATA WHERE ZNOTE = ?`).get(note.Z_PK) as
      | AppleNoteDataRow
      | undefined

    let content = ''
    const attachments: ParsedAttachment[] = []

    if (dataRow?.ZDATA) {
      const decompressed = decompressData(dataRow.ZDATA)
      const decoded = this.decodeProtobuf(decompressed)

      if (decoded) {
        const attachmentInfos = this.collectAttachmentInfos(decoded.attributeRun)
        content = this.reconstructMarkdown(decoded.noteText, decoded.attributeRun)

        // Resolve attachments
        for (const info of attachmentInfos) {
          const attachment = await this.resolveAttachment(
            db,
            info.attachmentIdentifier,
            note.ZACCOUNT,
            accountMap
          )
          if (attachment) attachments.push(attachment)
        }
      }
    }

    // If no content from protobuf, use the title as a fallback
    if (!content && note.ZTITLE1) {
      content = `# ${note.ZTITLE1}`
    }

    const folder = note.ZFOLDER != null ? (folderMap.get(note.ZFOLDER) ?? null) : null

    return {
      title: note.ZTITLE1 ?? 'Untitled',
      content,
      folder,
      createdAt: convertAppleDate(note.ZCREATIONDATE1),
      updatedAt: convertAppleDate(note.ZMODIFICATIONDATE1),
      attachments
    }
  }

  // --------------------------------------------------------------------------
  // Protobuf Decoding
  // --------------------------------------------------------------------------

  private getProtobufRoot(): protobuf.Root {
    if (!this.protobufRoot) {
      this.protobufRoot = protobuf.Root.fromJSON(PROTOBUF_DESCRIPTOR)
    }
    return this.protobufRoot
  }

  private decodeProtobuf(
    data: Buffer
  ): { noteText: string; attributeRun: DecodedAttributeRun[] } | null {
    try {
      const root = this.getProtobufRoot()
      const DocumentType = root.lookupType('ciofecaforensics.Document')
      const message = DocumentType.decode(data)
      const obj = DocumentType.toObject(message, {
        longs: Number,
        defaults: true
      }) as DecodedDocument

      if (!obj.note?.noteText) return null

      return {
        noteText: obj.note.noteText,
        attributeRun: obj.note.attributeRun ?? []
      }
    } catch (error) {
      this.warn(`Protobuf decode failed: ${(error as Error).message}`)
      return null
    }
  }

  // --------------------------------------------------------------------------
  // Markdown Reconstruction
  // --------------------------------------------------------------------------

  private reconstructMarkdown(noteText: string, attributeRuns: DecodedAttributeRun[]): string {
    if (!attributeRuns || attributeRuns.length === 0) return noteText

    let result = ''
    let offset = 0
    let inCodeBlock = false
    let listNumber = 0
    let lastStyleType: number | undefined

    for (const run of attributeRuns) {
      const fragment = noteText.substring(offset, offset + run.length)
      offset += run.length

      // Handle code blocks (multi-run)
      const styleType = run.paragraphStyle?.styleType
      if (styleType === StyleType.Monospaced && !inCodeBlock) {
        result += '\n```\n'
        inCodeBlock = true
      } else if (inCodeBlock && styleType !== StyleType.Monospaced) {
        result += '```\n'
        inCodeBlock = false
      }

      // Reset numbered list counter when style changes
      if (styleType !== StyleType.NumberedList && lastStyleType === StyleType.NumberedList) {
        listNumber = 0
      }
      lastStyleType = styleType

      if (inCodeBlock) {
        // Inside code blocks, emit raw text
        result += fragment
        continue
      }

      // Process each line in the fragment
      const lines = fragment.split('\n')

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]

        // Add newline between lines (but not before the first)
        if (i > 0) result += '\n'

        // Skip empty lines
        if (line.length === 0) continue

        // Skip object replacement characters that are just placeholders
        if (line === OBJECT_REPLACEMENT_CHAR) {
          // Attachment placeholder — replaced by attachment references below the note
          result += '(attachment)'
          continue
        }

        // Apply inline formatting
        let formatted = line.replace(OBJECT_REPLACEMENT_CHAR, '')

        if (run.fontWeight === FontWeight.Bold) {
          formatted = `**${formatted}**`
        } else if (run.fontWeight === FontWeight.Italic) {
          formatted = `*${formatted}*`
        } else if (run.fontWeight === FontWeight.BoldItalic) {
          formatted = `***${formatted}***`
        }

        if (run.strikethrough) {
          formatted = `~~${formatted}~~`
        }

        if (run.link && run.link !== formatted) {
          formatted = `[${formatted}](${run.link})`
        }

        // Apply paragraph formatting (only at line start within a run)
        const indent = '\t'.repeat(run.paragraphStyle?.indentAmount ?? 0)
        const blockquotePrefix = run.paragraphStyle?.blockquote ? '> ' : ''

        switch (styleType) {
          case StyleType.Title:
            formatted = `${blockquotePrefix}# ${formatted}`
            break
          case StyleType.Heading:
            formatted = `${blockquotePrefix}## ${formatted}`
            break
          case StyleType.Subheading:
            formatted = `${blockquotePrefix}### ${formatted}`
            break
          case StyleType.DottedList:
          case StyleType.DashedList:
            formatted = `${blockquotePrefix}${indent}- ${formatted}`
            break
          case StyleType.NumberedList:
            if (i === 0) listNumber++
            formatted = `${blockquotePrefix}${indent}${listNumber}. ${formatted}`
            break
          case StyleType.Checkbox: {
            const checked = run.paragraphStyle?.checklist?.done ? 'x' : ' '
            formatted = `${blockquotePrefix}${indent}- [${checked}] ${formatted}`
            break
          }
          default:
            if (blockquotePrefix) {
              formatted = `${blockquotePrefix}${formatted}`
            }
            break
        }

        result += formatted
      }
    }

    // Close any open code block
    if (inCodeBlock) {
      result += '```\n'
    }

    return result.trim()
  }

  private collectAttachmentInfos(attributeRuns: DecodedAttributeRun[]): DecodedAttachmentInfo[] {
    const infos: DecodedAttachmentInfo[] = []
    for (const run of attributeRuns) {
      if (run.attachmentInfo?.attachmentIdentifier) {
        infos.push(run.attachmentInfo)
      }
    }
    return infos
  }

  // --------------------------------------------------------------------------
  // Attachment Resolution
  // --------------------------------------------------------------------------

  private async resolveAttachment(
    db: InstanceType<typeof Database>,
    attachmentIdentifier: string,
    noteAccountPk: number | null,
    accountMap: Map<number, string>
  ): Promise<ParsedAttachment | null> {
    try {
      // Look up the attachment object
      const attachRow = db
        .prepare(
          `SELECT Z_PK, ZIDENTIFIER, ZMEDIA, ZTYPEUTI
           FROM ZICCLOUDSYNCINGOBJECT
           WHERE ZIDENTIFIER = ?`
        )
        .get(attachmentIdentifier) as AppleNoteAttachmentRow | undefined

      if (!attachRow?.ZMEDIA) return null

      // Look up the media file
      const mediaRow = db
        .prepare(
          `SELECT Z_PK, ZFILENAME, ZIDENTIFIER
           FROM ZICCLOUDSYNCINGOBJECT
           WHERE Z_PK = ?`
        )
        .get(attachRow.ZMEDIA) as AppleNoteMediaRow | undefined

      if (!mediaRow?.ZFILENAME || !mediaRow.ZIDENTIFIER) return null

      // Get account UUID for path construction
      const accountUuid = noteAccountPk != null ? accountMap.get(noteAccountPk) : null
      if (!accountUuid) {
        this.warn(`No account UUID found for attachment ${attachmentIdentifier}`)
        return null
      }

      // Construct the file path
      const filePath = join(
        NOTES_CONTAINER,
        'Accounts',
        accountUuid,
        'Media',
        mediaRow.ZIDENTIFIER,
        mediaRow.ZFILENAME
      )

      const data = await fs.readFile(filePath)

      return {
        originalPath: filePath,
        filename: mediaRow.ZFILENAME,
        type: this.determineAssetType(mediaRow.ZFILENAME),
        data
      }
    } catch (error) {
      this.warn(`Failed to resolve attachment ${attachmentIdentifier}: ${(error as Error).message}`)
      return null
    }
  }

  // --------------------------------------------------------------------------
  // Folder Hierarchy
  // --------------------------------------------------------------------------

  private buildEntityKeys(db: InstanceType<typeof Database>): EntityKeys {
    const rows = db
      .prepare('SELECT Z_ENT, Z_NAME FROM Z_PRIMARYKEY')
      .all() as { Z_ENT: number; Z_NAME: string }[]

    const map: Record<string, number> = {}
    for (const row of rows) map[row.Z_NAME] = row.Z_ENT

    return {
      ICNote: map['ICNote'] ?? -1,
      ICFolder: map['ICFolder'] ?? -1,
      ICAccount: map['ICAccount'] ?? -1,
      ICAttachment: map['ICAttachment'] ?? -1,
      ICMedia: map['ICMedia'] ?? -1
    }
  }

  private buildTrashFolderIds(
    db: InstanceType<typeof Database>,
    keys: EntityKeys
  ): number[] {
    try {
      const rows = db
        .prepare(
          `SELECT Z_PK FROM ZICCLOUDSYNCINGOBJECT
           WHERE Z_ENT = ${keys.ICFolder} AND ZFOLDERTYPE = 1`
        )
        .all() as { Z_PK: number }[]
      return rows.map((r) => r.Z_PK)
    } catch {
      return []
    }
  }

  private buildFolderMap(
    db: InstanceType<typeof Database>,
    keys: EntityKeys
  ): Map<number, string> {
    const rows = db
      .prepare(
        `SELECT Z_PK, ZTITLE2, ZPARENT
         FROM ZICCLOUDSYNCINGOBJECT
         WHERE Z_ENT = ${keys.ICFolder}`
      )
      .all() as AppleNoteFolderRow[]

    // Build lookup: Z_PK → row
    const rowMap = new Map<number, AppleNoteFolderRow>()
    for (const row of rows) {
      rowMap.set(row.Z_PK, row)
    }

    // Resolve full paths by walking parent chain
    const folderMap = new Map<number, string>()

    const resolvePath = (pk: number, visited: Set<number>): string => {
      const cached = folderMap.get(pk)
      if (cached !== undefined) return cached

      const row = rowMap.get(pk)
      if (!row || !row.ZTITLE2) {
        folderMap.set(pk, '')
        return ''
      }

      // Guard against circular references
      if (visited.has(pk)) {
        folderMap.set(pk, row.ZTITLE2)
        return row.ZTITLE2
      }
      visited.add(pk)

      if (row.ZPARENT != null && rowMap.has(row.ZPARENT)) {
        const parentPath = resolvePath(row.ZPARENT, visited)
        const fullPath = parentPath ? `${parentPath}/${row.ZTITLE2}` : row.ZTITLE2
        folderMap.set(pk, fullPath)
        return fullPath
      }

      folderMap.set(pk, row.ZTITLE2)
      return row.ZTITLE2
    }

    for (const row of rows) {
      resolvePath(row.Z_PK, new Set())
    }

    return folderMap
  }

  private buildAccountMap(
    db: InstanceType<typeof Database>,
    keys: EntityKeys
  ): Map<number, string> {
    const accountMap = new Map<number, string>()

    try {
      const rows = db
        .prepare(
          `SELECT Z_PK, ZIDENTIFIER
           FROM ZICCLOUDSYNCINGOBJECT
           WHERE Z_ENT = ${keys.ICAccount}`
        )
        .all() as AppleNoteAccountRow[]

      for (const row of rows) {
        if (row.ZIDENTIFIER) {
          accountMap.set(row.Z_PK, row.ZIDENTIFIER)
        }
      }
    } catch (error) {
      this.warn(`Failed to build account map: ${(error as Error).message}`)
    }

    return accountMap
  }

  // --------------------------------------------------------------------------
  // Fallback Mode: Exported Files
  // --------------------------------------------------------------------------

  private async scanFallbackDirectory(dirPath: string): Promise<ImportScanResult> {
    const warnings: string[] = []
    const files = await this.walkFallbackDirectory(dirPath)

    const folderSet = new Set<string>()
    for (const file of files) {
      const dir = dirname(file.relativePath)
      if (dir !== '.') folderSet.add(dir)
    }
    const folders = Array.from(folderSet).sort()

    const sampleTitles = files
      .slice(0, 10)
      .map((f) => basename(f.relativePath, extname(f.relativePath)))

    let totalSizeBytes = 0
    for (const file of files) {
      try {
        const stat = await fs.stat(file.absolutePath)
        totalSizeBytes += stat.size
      } catch (error) {
        const msg = `Failed to stat ${file.relativePath}: ${(error as Error).message}`
        this.warn(msg)
        warnings.push(msg)
      }
    }

    this.log(`Fallback scan complete: ${files.length} files, ${folders.length} folders`)

    return {
      source: 'apple-notes',
      totalFiles: files.length,
      folders,
      sampleTitles,
      totalSizeBytes,
      hasAttachments: false,
      warnings
    }
  }

  private async parseFallbackDirectory(dirPath: string): Promise<ParsedNote[]> {
    const files = await this.walkFallbackDirectory(dirPath)
    const turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced'
    })

    const results: ParsedNote[] = []

    for (const file of files) {
      try {
        const raw = await fs.readFile(file.absolutePath, 'utf-8')

        let title: string
        let content: string

        if (file.isHtml) {
          content = turndown.turndown(raw)
          title = extractHtmlTitle(raw) ?? basename(file.relativePath, extname(file.relativePath))
        } else {
          content = raw
          title = basename(file.relativePath, '.md')
        }

        const dir = dirname(file.relativePath)
        const folder = dir === '.' ? null : dir

        results.push({
          title,
          content,
          folder,
          attachments: []
        })
      } catch (error) {
        this.warn(`Failed to parse ${file.relativePath}: ${(error as Error).message}`)
      }
    }

    this.log(`Fallback parsed ${results.length}/${files.length} files`)
    return results
  }

  private async walkFallbackDirectory(dirPath: string): Promise<FallbackFile[]> {
    const results: FallbackFile[] = []
    const stack: string[] = [dirPath]

    while (stack.length > 0) {
      const currentDir = stack.pop()!

      let entries
      try {
        entries = await fs.readdir(currentDir, { withFileTypes: true })
      } catch (error) {
        this.warn(
          `Cannot read directory ${relative(dirPath, currentDir)}: ${(error as Error).message}`
        )
        continue
      }

      for (const entry of entries) {
        // Skip hidden files and directories
        if (entry.name.startsWith('.')) continue
        if (entry.isSymbolicLink()) continue

        const fullPath = join(currentDir, entry.name)

        if (entry.isDirectory()) {
          stack.push(fullPath)
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase()
          if (ext === '.md' || ext === '.html' || ext === '.htm') {
            results.push({
              absolutePath: fullPath,
              relativePath: relative(dirPath, fullPath),
              isHtml: ext === '.html' || ext === '.htm'
            })
          }
        }
      }
    }

    return results
  }

  // --------------------------------------------------------------------------
  // Utilities
  // --------------------------------------------------------------------------

  private isDatabasePath(sourcePath: string): boolean {
    return sourcePath.endsWith('.sqlite') || sourcePath === DB_PATH
  }
}

// ============================================================================
// Decoded Protobuf Types (output of protobufjs toObject)
// ============================================================================

interface DecodedDocument {
  version?: number
  note?: {
    noteText: string
    attributeRun?: DecodedAttributeRun[]
  }
}

interface DecodedAttributeRun {
  length: number
  paragraphStyle?: {
    styleType?: number
    alignment?: number
    indentAmount?: number
    checklist?: { done?: number; uuid?: Uint8Array }
    blockquote?: number
  }
  font?: {
    fontName?: string
    pointSize?: number
    fontHints?: number
  }
  fontWeight?: number
  underlined?: number
  strikethrough?: number
  superscript?: number
  link?: string
  attachmentInfo?: DecodedAttachmentInfo
}

interface DecodedAttachmentInfo {
  attachmentIdentifier: string
  typeUti?: string
}
