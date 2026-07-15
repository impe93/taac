import { promises as fs } from 'fs'
import { join, relative, dirname, basename, extname } from 'path'

import { BaseParser } from './BaseParser'
import type { ImportScanResult, ParsedNote, ParsedAttachment } from '../types'

// ============================================================================
// Internal Types
// ============================================================================

interface ExportFile {
  absolutePath: string
  relativePath: string
  isMarkdown: boolean
}

/**
 * A resource reference found in a note body.
 */
interface ResourceRef {
  /** The exact path string as it appears inside the markdown link parentheses. */
  rawTarget: string
  /** Decoded basename used to look the file up inside `_resources/`. */
  filename: string
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

    // Key-value pair: `key: value` (Joplin keys may end with `?`, e.g. `completed?`)
    const kvMatch = line.match(/^([\w][\w\s?-]*?):\s*(.*)$/)
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
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return { frontmatter: null, body: content }

  const frontmatter = parseSimpleYaml(match[1])
  const body = match[2]

  return { frontmatter, body }
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

/**
 * Extract a creation date from Joplin front matter.
 *
 * Joplin formats dates as `YYYY-MM-DD HH:MM` (local time), which `Date` parses,
 * but we also accept ISO strings for robustness.
 */
function extractCreatedDate(frontmatter: Record<string, unknown> | null): string | undefined {
  if (!frontmatter) return undefined

  const raw = frontmatter.created ?? frontmatter.created_at ?? frontmatter.date
  if (!raw || typeof raw !== 'string') return undefined

  const parsed = new Date(raw)
  if (isNaN(parsed.getTime())) return undefined

  return parsed.toISOString()
}

/**
 * Extract references to `_resources/` files from a markdown body.
 *
 * Handles both image (`![alt](target)`) and file-link (`[text](target)`) forms.
 * Only targets that point inside a `_resources/` directory are returned;
 * external URLs and note-to-note links are ignored.
 */
function extractResourceRefs(body: string): ResourceRef[] {
  const regex = /!?\[[^\]]*\]\(([^)]+)\)/g
  const seen = new Set<string>()
  const refs: ResourceRef[] = []

  for (const match of body.matchAll(regex)) {
    const rawInner = match[1].trim()

    // Strip an optional markdown title: `(path "title")`
    const urlMatch = rawInner.match(/^(\S+)(?:\s+"[^"]*")?$/)
    const rawTarget = urlMatch ? urlMatch[1] : rawInner

    // Skip external links, anchors, and already-rewritten refs
    if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(rawTarget)) continue

    const decoded = decodeURIComponent(rawTarget)

    // Only consider targets inside a `_resources/` folder
    if (!/(^|\/)_resources\//.test(decoded)) continue

    if (seen.has(rawTarget)) continue
    seen.add(rawTarget)

    refs.push({ rawTarget, filename: basename(decoded) })
  }

  return refs
}

// ============================================================================
// JoplinParser
// ============================================================================

/**
 * Parser for Joplin "MD - Markdown" and "MD - Markdown + Front Matter" directory
 * exports.
 *
 * Notebooks are represented as nested directories, attachments live in a top-level
 * `_resources/` folder, and resources are referenced with standard markdown links.
 * Structurally close to an Obsidian vault, so this mirrors ObsidianParser.
 */
export class JoplinParser extends BaseParser {
  private static readonly RESOURCES_DIR = '_resources'
  private static readonly SKIP_DIRS = new Set([JoplinParser.RESOURCES_DIR, '.git'])

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  async scan(sourcePath: string): Promise<ImportScanResult> {
    const warnings: string[] = []

    const files = await this.walkDirectory(sourcePath)
    const markdownFiles = files.filter((f) => f.isMarkdown)

    const hasAttachments = await this.hasResources(sourcePath)

    if (markdownFiles.length === 0) {
      const msg = 'Directory does not appear to be a Joplin Markdown export'
      this.warn(msg)
      warnings.push(msg)
    }

    // Collect unique folder paths (notebooks)
    const folderSet = new Set<string>()
    for (const file of markdownFiles) {
      const dir = dirname(file.relativePath)
      if (dir !== '.') folderSet.add(dir)
    }
    const folders = Array.from(folderSet).sort()

    // Sample titles from first 10 filenames
    const sampleTitles = markdownFiles.slice(0, 10).map((f) => basename(f.relativePath, '.md'))

    // Sum file sizes (notes + resources)
    let totalSizeBytes = 0
    const sizedFiles = [...files]
    const resourceFiles = await this.listResources(sourcePath)
    sizedFiles.push(...resourceFiles)
    for (const file of sizedFiles) {
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
      source: 'joplin',
      totalFiles: markdownFiles.length,
      folders,
      sampleTitles,
      totalSizeBytes,
      hasAttachments,
      warnings
    }
  }

  async parse(sourcePath: string): Promise<ParsedNote[]> {
    const files = await this.walkDirectory(sourcePath)
    const markdownFiles = files.filter((f) => f.isMarkdown)

    // Build resource lookup: lowercase decoded filename → absolute paths[]
    const resourceFiles = await this.listResources(sourcePath)
    const fileMap = new Map<string, string[]>()
    for (const file of resourceFiles) {
      const key = basename(file.absolutePath).toLowerCase()
      const existing = fileMap.get(key) ?? []
      existing.push(file.absolutePath)
      fileMap.set(key, existing)
    }

    const results: ParsedNote[] = []

    for (const file of markdownFiles) {
      try {
        const raw = await fs.readFile(file.absolutePath, 'utf-8')
        const { frontmatter, body } = extractFrontmatter(raw)

        const title = resolveTitle(frontmatter, body, basename(file.relativePath))
        const processedBody = appendTagsSection(body, frontmatter)
        const createdAt = extractCreatedDate(frontmatter)

        const dir = dirname(file.relativePath)
        const folder = dir === '.' ? null : dir

        // Resolve attachments referenced in the body
        const attachments: ParsedAttachment[] = []
        for (const ref of extractResourceRefs(body)) {
          const attachment = await this.resolveAttachment(ref, fileMap)
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

  private async walkDirectory(exportRoot: string): Promise<ExportFile[]> {
    const results: ExportFile[] = []
    const stack: string[] = [exportRoot]

    while (stack.length > 0) {
      const dirPath = stack.pop()!

      let entries
      try {
        entries = await fs.readdir(dirPath, { withFileTypes: true })
      } catch (error) {
        this.warn(
          `Cannot read directory ${relative(exportRoot, dirPath)}: ${(error as Error).message}`
        )
        continue
      }

      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name)

        if (entry.isSymbolicLink()) continue

        if (entry.isDirectory()) {
          if (JoplinParser.SKIP_DIRS.has(entry.name)) continue
          stack.push(fullPath)
        } else if (entry.isFile()) {
          results.push({
            absolutePath: fullPath,
            relativePath: relative(exportRoot, fullPath),
            isMarkdown: extname(entry.name).toLowerCase() === '.md'
          })
        }
      }
    }

    return results
  }

  /**
   * List every file inside the top-level `_resources/` directory (recursively).
   */
  private async listResources(exportRoot: string): Promise<ExportFile[]> {
    const resourcesRoot = join(exportRoot, JoplinParser.RESOURCES_DIR)
    const results: ExportFile[] = []
    const stack: string[] = [resourcesRoot]

    while (stack.length > 0) {
      const dirPath = stack.pop()!

      let entries
      try {
        entries = await fs.readdir(dirPath, { withFileTypes: true })
      } catch {
        // No _resources directory — that's fine
        continue
      }

      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name)
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory()) {
          stack.push(fullPath)
        } else if (entry.isFile()) {
          results.push({
            absolutePath: fullPath,
            relativePath: relative(exportRoot, fullPath),
            isMarkdown: false
          })
        }
      }
    }

    return results
  }

  private async hasResources(exportRoot: string): Promise<boolean> {
    const resources = await this.listResources(exportRoot)
    return resources.length > 0
  }

  private async resolveAttachment(
    ref: ResourceRef,
    fileMap: Map<string, string[]>
  ): Promise<ParsedAttachment | null> {
    const candidates = fileMap.get(ref.filename.toLowerCase())
    if (!candidates || candidates.length === 0) {
      this.warn(`Attachment not found: ${ref.filename}`)
      return null
    }

    const resolvedPath = candidates[0]

    try {
      const data = await fs.readFile(resolvedPath)
      return {
        // The exact in-body link string, so ImportManager can rewrite it.
        originalPath: ref.rawTarget,
        filename: ref.filename,
        type: this.determineAssetType(ref.filename),
        data
      }
    } catch (error) {
      this.warn(`Failed to read attachment ${ref.filename}: ${(error as Error).message}`)
      return null
    }
  }
}
