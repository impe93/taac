/**
 * Import Subsystem — Shared TypeScript Types
 *
 * Contains all shared type definitions for the note import subsystem.
 * Reference: docs/ONBOARDING_NEW_USER.md Section 4.1
 */

// ============================================================================
// SOURCE TYPES
// ============================================================================

/**
 * Supported note import sources
 */
export type ImportSource = 'apple-notes' | 'obsidian' | 'joplin'

// ============================================================================
// IMPORT CONFIGURATION
// ============================================================================

/**
 * Options for configuring a note import operation
 */
export interface ImportOptions {
  source: ImportSource
  sourcePath: string
  targetMode: 'new-space' | 'existing-space'
  targetSpaceId?: string
  newSpaceName?: string
  newSpaceIcon?: string
}

// ============================================================================
// IMPORT RESULTS
// ============================================================================

/**
 * Result of a pre-import scan — provides a preview of what will be imported
 */
export interface ImportScanResult {
  source: ImportSource
  totalFiles: number
  folders: string[]
  sampleTitles: string[]
  totalSizeBytes: number
  hasAttachments: boolean
  warnings: string[]
}

/**
 * Final result after a completed import operation
 */
export interface ImportResult {
  spaceId: string
  totalFiles: number
  importedNotes: number
  importedFolders: number
  importedAttachments: number
  skippedFiles: number
  errors: ImportFileError[]
}

/**
 * Error encountered while importing a specific file
 */
export interface ImportFileError {
  filePath: string
  error: string
}

// ============================================================================
// PROGRESS TRACKING
// ============================================================================

/**
 * Progress event emitted during an import operation
 */
export interface ImportProgressEvent {
  phase: 'scanning' | 'converting' | 'creating' | 'complete'
  current: number
  total: number
  currentFile: string | null
  status: 'in-progress' | 'complete' | 'error'
  error?: string
}

// ============================================================================
// PARSED DATA
// ============================================================================

/**
 * A note parsed from the source, ready for creation in TaacNotes
 */
export interface ParsedNote {
  title: string
  content: string
  folder: string | null
  createdAt?: string
  updatedAt?: string
  attachments: ParsedAttachment[]
}

/**
 * An attachment parsed from the source, with file content loaded into memory
 */
export interface ParsedAttachment {
  originalPath: string
  filename: string
  type: 'images' | 'pdfs' | 'attachments'
  data: Buffer
}
