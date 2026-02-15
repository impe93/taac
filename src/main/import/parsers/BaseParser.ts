import { randomUUID } from 'node:crypto'
import { extname } from 'node:path'

import type { ImportScanResult, ParsedNote } from '../types'

/**
 * Abstract base class for note import parsers.
 *
 * Provides shared utilities for file type detection and safe filename generation.
 * Concrete implementations (AppleNotesParser, ObsidianParser) must implement
 * the scan() and parse() methods.
 *
 * Reference: docs/ONBOARDING_NEW_USER.md Section 4.2
 */
export abstract class BaseParser {
  /**
   * Preview scan of the source — returns metadata without performing a full parse.
   */
  abstract scan(sourcePath: string): Promise<ImportScanResult>

  /**
   * Full parse of the source — returns all notes with content and attachments.
   */
  abstract parse(sourcePath: string): Promise<ParsedNote[]>

  /**
   * Map a file extension to the corresponding TaacNotes asset category.
   */
  protected determineAssetType(filename: string): 'images' | 'pdfs' | 'attachments' {
    const ext = extname(filename).toLowerCase()

    const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'])
    if (imageExtensions.has(ext)) return 'images'

    if (ext === '.pdf') return 'pdfs'

    return 'attachments'
  }

  /**
   * Generate a collision-safe filename by prepending a UUID.
   */
  protected generateSafeFilename(original: string): string {
    const id = randomUUID()
    return `${id}-${original}`
  }

  protected log(message: string): void {
    console.log(`[${this.constructor.name}] ${message}`)
  }

  protected warn(message: string): void {
    console.warn(`[${this.constructor.name}] ${message}`)
  }
}
