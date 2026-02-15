import { promises as fs } from 'fs'
import { join, relative, dirname, basename, extname } from 'path'

import { BaseParser } from './BaseParser'
import type { ImportScanResult, ParsedNote, ParsedAttachment } from '../types'

// ============================================================================
// Internal Types
// ============================================================================

interface VaultFile {
  absolutePath: string
  relativePath: string
  isMarkdown: boolean
}

interface ObsidianAppConfig {
  attachmentFolderPath?: string
}

// ============================================================================
// Pure Helper Functions
// ============================================================================

function parseSimpleYaml(yamlString: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const lines = yamlString.split('\n')

  let currentKey: string | null = null
  let currentArray: string[] | null = null

  for (const line of lines) {
    // Multi-line array item: `  - value` or `- value`
    const arrayItemMatch = line.match(/^\s*-\s+(.+)$/)
    if (arrayItemMatch && currentKey && currentArray) {
      const value = arrayItemMatch[1].trim().replace(/^['"]|['"]$/g, '')
      currentArray.push(value)
      continue
    }

    // Flush any pending array
    if (currentKey && currentArray) {
      result[currentKey] = currentArray
      currentKey = null
      currentArray = null
    }

    // Key-value pair: `key: value`
    const kvMatch = line.match(/^([\w][\w\s-]*?):\s*(.*)$/)
    if (!kvMatch) continue

    const key = kvMatch[1].trim()
    const rawValue = kvMatch[2].trim()

    // Empty value — start of multi-line array
    if (rawValue === '') {
      currentKey = key
      currentArray = []
      continue
    }

    // Inline array: `[a, b, c]`
    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      const inner = rawValue.slice(1, -1)
      result[key] = inner
        .split(',')
        .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
        .filter((item) => item.length > 0)
      continue
    }

    // Plain value — strip quotes
    result[key] = rawValue.replace(/^['"]|['"]$/g, '')
  }

  // Flush trailing array
  if (currentKey && currentArray) {
    result[currentKey] = currentArray
  }

  return result
}

function extractFrontmatter(content: string): {
  frontmatter: Record<string, unknown> | null
  body: string
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return { frontmatter: null, body: content }

  const frontmatter = parseSimpleYaml(match[1])
  const body = match[2]

  return { frontmatter, body }
}

function convertWikilinks(content: string): string {
  // [[Page Name|Display Text]] → Display Text (aliased form first)
  content = content.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')

  // [[Page Name]] → Page Name
  content = content.replace(/\[\[([^\]]+)\]\]/g, '$1')

  return content
}

function convertEmbeds(content: string): string {
  // ![[image.png]] or ![[image.png|400]] → ![image.png]()
  content = content.replace(/!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, (_, filename: string) => {
    return `![${filename.trim()}]()`
  })

  return content
}

function resolveTitle(
  frontmatter: Record<string, unknown> | null,
  body: string,
  filename: string
): string {
  // Priority 1: frontmatter title
  if (frontmatter?.title && typeof frontmatter.title === 'string') {
    const title = frontmatter.title.trim()
    if (title.length > 0) return title
  }

  // Priority 2: first # heading
  const headingMatch = body.match(/^#\s+(.+)$/m)
  if (headingMatch) {
    const heading = headingMatch[1].trim()
    if (heading.length > 0) return heading
  }

  // Priority 3: filename without .md
  return basename(filename, '.md')
}

function appendTagsSection(body: string, frontmatter: Record<string, unknown> | null): string {
  if (!frontmatter?.tags) return body

  let tags: string[] = []

  if (Array.isArray(frontmatter.tags)) {
    tags = frontmatter.tags.map((t) => String(t).trim()).filter((t) => t.length > 0)
  } else if (typeof frontmatter.tags === 'string') {
    tags = frontmatter.tags
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
  }

  if (tags.length === 0) return body

  return `${body}\n\n## Tags\n\n${tags.join(', ')}`
}

function extractCreatedDate(frontmatter: Record<string, unknown> | null): string | undefined {
  if (!frontmatter) return undefined

  const raw = frontmatter.date ?? frontmatter.created ?? frontmatter.created_at
  if (!raw || typeof raw !== 'string') return undefined

  const parsed = new Date(raw)
  if (isNaN(parsed.getTime())) return undefined

  return parsed.toISOString()
}

// ============================================================================
// ObsidianParser
// ============================================================================

export class ObsidianParser extends BaseParser {
  private static readonly SKIP_DIRS = new Set(['.obsidian', '.trash', '.git'])

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  async scan(sourcePath: string): Promise<ImportScanResult> {
    const warnings: string[] = []

    const isVault = await this.isObsidianVault(sourcePath)
    if (!isVault) {
      this.warn('Directory does not appear to be an Obsidian vault')
      warnings.push('Directory does not appear to be an Obsidian vault')
    }

    const files = await this.walkDirectory(sourcePath)
    const markdownFiles = files.filter((f) => f.isMarkdown)
    const nonMarkdownFiles = files.filter((f) => !f.isMarkdown)

    // Collect unique folder paths
    const folderSet = new Set<string>()
    for (const file of markdownFiles) {
      const dir = dirname(file.relativePath)
      if (dir !== '.') folderSet.add(dir)
    }
    const folders = Array.from(folderSet).sort()

    // Sample titles from first 10 filenames
    const sampleTitles = markdownFiles.slice(0, 10).map((f) => basename(f.relativePath, '.md'))

    // Sum file sizes
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

    this.log(`Scan complete: ${markdownFiles.length} notes, ${folders.length} folders`)

    return {
      source: 'obsidian',
      totalFiles: markdownFiles.length,
      folders,
      sampleTitles,
      totalSizeBytes,
      hasAttachments: nonMarkdownFiles.length > 0,
      warnings
    }
  }

  async parse(sourcePath: string): Promise<ParsedNote[]> {
    const files = await this.walkDirectory(sourcePath)
    const config = await this.readObsidianConfig(sourcePath)

    // Build attachment lookup: lowercase filename → absolute paths[]
    const fileMap = new Map<string, string[]>()
    for (const file of files) {
      if (file.isMarkdown) continue
      const key = basename(file.absolutePath).toLowerCase()
      const existing = fileMap.get(key) ?? []
      existing.push(file.absolutePath)
      fileMap.set(key, existing)
    }

    const markdownFiles = files.filter((f) => f.isMarkdown)
    const results: ParsedNote[] = []

    for (const file of markdownFiles) {
      try {
        const raw = await fs.readFile(file.absolutePath, 'utf-8')
        const { frontmatter, body } = extractFrontmatter(raw)

        const title = resolveTitle(frontmatter, body, basename(file.relativePath))
        const embedFilenames = this.extractEmbedFilenames(body)

        let processedBody = appendTagsSection(body, frontmatter)
        processedBody = convertEmbeds(processedBody)
        processedBody = convertWikilinks(processedBody)

        const createdAt = extractCreatedDate(frontmatter)

        const dir = dirname(file.relativePath)
        const folder = dir === '.' ? null : dir

        // Resolve attachments
        const attachments: ParsedAttachment[] = []
        for (const embedName of embedFilenames) {
          const attachment = await this.resolveAttachment(
            embedName,
            file.absolutePath,
            sourcePath,
            config,
            fileMap
          )
          if (attachment) attachments.push(attachment)
        }

        results.push({
          title,
          content: processedBody,
          folder,
          createdAt,
          attachments
        })
      } catch (error) {
        this.warn(`Failed to parse ${file.relativePath}: ${(error as Error).message}`)
      }
    }

    this.log(`Parsed ${results.length}/${markdownFiles.length} notes`)
    return results
  }

  // --------------------------------------------------------------------------
  // Private Helpers
  // --------------------------------------------------------------------------

  private async isObsidianVault(dirPath: string): Promise<boolean> {
    try {
      await fs.access(join(dirPath, '.obsidian'))
      return true
    } catch {
      // Fallback: check for .md files
      const entries = await fs.readdir(dirPath)
      return entries.some((f) => f.endsWith('.md'))
    }
  }

  private async walkDirectory(vaultRoot: string): Promise<VaultFile[]> {
    const results: VaultFile[] = []
    const stack: string[] = [vaultRoot]

    while (stack.length > 0) {
      const dirPath = stack.pop()!

      let entries
      try {
        entries = await fs.readdir(dirPath, { withFileTypes: true })
      } catch (error) {
        this.warn(
          `Cannot read directory ${relative(vaultRoot, dirPath)}: ${(error as Error).message}`
        )
        continue
      }

      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name)

        if (entry.isSymbolicLink()) continue

        if (entry.isDirectory()) {
          if (ObsidianParser.SKIP_DIRS.has(entry.name)) continue
          stack.push(fullPath)
        } else if (entry.isFile()) {
          results.push({
            absolutePath: fullPath,
            relativePath: relative(vaultRoot, fullPath),
            isMarkdown: extname(entry.name).toLowerCase() === '.md'
          })
        }
      }
    }

    return results
  }

  private async readObsidianConfig(vaultRoot: string): Promise<ObsidianAppConfig> {
    try {
      const raw = await fs.readFile(join(vaultRoot, '.obsidian', 'app.json'), 'utf-8')
      const parsed = JSON.parse(raw) as Record<string, unknown>
      if (
        typeof parsed.attachmentFolderPath === 'string' &&
        parsed.attachmentFolderPath.length > 0
      ) {
        return { attachmentFolderPath: parsed.attachmentFolderPath }
      }
      return {}
    } catch {
      this.log('No Obsidian config found, using defaults')
      return {}
    }
  }

  private async resolveAttachment(
    filename: string,
    noteAbsolutePath: string,
    vaultRoot: string,
    config: ObsidianAppConfig,
    fileMap: Map<string, string[]>
  ): Promise<ParsedAttachment | null> {
    const candidates = fileMap.get(filename.toLowerCase())
    if (!candidates || candidates.length === 0) {
      this.warn(`Attachment not found: ${filename}`)
      return null
    }

    let resolvedPath: string | null = null

    // Priority 1: configured attachment folder
    if (config.attachmentFolderPath) {
      const attachDir = join(vaultRoot, config.attachmentFolderPath)
      resolvedPath = candidates.find((p) => dirname(p) === attachDir) ?? null
    }

    // Priority 2: same folder as the note
    if (!resolvedPath) {
      const noteDir = dirname(noteAbsolutePath)
      resolvedPath = candidates.find((p) => dirname(p) === noteDir) ?? null
    }

    // Priority 3: vault root
    if (!resolvedPath) {
      resolvedPath = candidates.find((p) => dirname(p) === vaultRoot) ?? null
    }

    // Priority 4: anywhere (first candidate)
    if (!resolvedPath) {
      resolvedPath = candidates[0]
    }

    try {
      const data = await fs.readFile(resolvedPath)
      return {
        originalPath: resolvedPath,
        filename,
        type: this.determineAssetType(filename),
        data
      }
    } catch (error) {
      this.warn(`Failed to read attachment ${filename}: ${(error as Error).message}`)
      return null
    }
  }

  private extractEmbedFilenames(body: string): string[] {
    const regex = /!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g
    const filenames = new Set<string>()
    for (const match of body.matchAll(regex)) {
      filenames.add(match[1].trim())
    }
    return Array.from(filenames)
  }
}
