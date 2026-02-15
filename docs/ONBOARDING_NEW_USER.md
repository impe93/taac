# TaacNotes — New User Onboarding

## 1. Overview

This document specifies the architecture for a first-run onboarding wizard that guides new users through three core setup steps:

1. **Note Import** — Import existing notes from Apple Notes (direct database access) or Obsidian vaults
2. **AI Model Download** — Download the base chat model (Qwen3 4B, ~4.3 GB) and embedding model (Nomic Embed v2, ~512 MB)
3. **Quick Tutorial** — Brief orientation on notes, spaces, AI assistant, and smart search

The onboarding is a full-page wizard that replaces the app chrome (no sidebar, no header) until completed or explicitly skipped. Every step is individually skippable.

---

## 2. First-Run Detection

### 2.1 New Config Key

Add `onboardingCompleted` to the AppConfig schema.

**File:** `src/main/utils/configStore.ts`

```typescript
// Add to AppConfig interface
onboardingCompleted: boolean

// Add to schema object
onboardingCompleted: {
  type: 'boolean',
  default: false
}
```

This key is set to `true` only when:
- The user completes the final onboarding step, OR
- The user clicks "Skip" at any point (which skips all remaining steps)

### 2.2 Defer Default Space Creation

Currently, `src/main/index.ts` (lines 128–132) auto-creates a "Personal" space when no spaces exist. This must be conditional on onboarding completion so that the user can choose to create a space through import or manually during onboarding.

**File:** `src/main/index.ts`

Change:
```typescript
const spaces = await spaceManager.listSpaces()
if (spaces.length === 0) {
  await spaceManager.createSpace('Personal', 'Home')
  configStore.set('spacesInitialized', true)
}
```

To:
```typescript
const spaces = await spaceManager.listSpaces()
const onboardingDone = configStore.get('onboardingCompleted')
if (spaces.length === 0 && onboardingDone) {
  // Safety net: auto-create only if onboarding was already completed
  // (e.g., user deleted all spaces post-onboarding)
  await spaceManager.createSpace('Personal', 'Home')
  configStore.set('spacesInitialized', true)
}
```

### 2.3 Conditional Root Layout

The root layout (`src/renderer/src/routes/__root.tsx`) currently always renders `AppSidebar`, `SidebarInset`, header with AI toggle, and `MainContentWithAIPanel`. During onboarding, only the window drag border and a minimal container should render.

**File:** `src/renderer/src/routes/__root.tsx`

```typescript
const RootLayout: FC = () => {
  const isMacOS = window.platform === 'darwin'
  const { data: onboardingDone } = useConfig('onboardingCompleted')
  const { isOpen, toggle } = useAIChatPanel()

  // Minimal layout for onboarding (no sidebar, no header, no AI panel)
  if (!onboardingDone) {
    return (
      <>
        <WindowDragBorder />
        <div
          className="h-screen w-full"
          style={{
            padding: WINDOW_BORDER_WIDTH,
            paddingTop: isMacOS ? WINDOW_TRAFFIC_LIGHTS_HEIGHT : WINDOW_BORDER_WIDTH
          }}
        >
          <div className="h-full overflow-hidden rounded-xl bg-background">
            <Outlet />
          </div>
        </div>
      </>
    )
  }

  // ... existing full layout with sidebar, header, AI panel
}
```

The `useConfig` hook (from `src/renderer/src/hooks/useConfig.ts`) already provides reactive config reading via TanStack Query.

### 2.4 Route Redirect

When `onboardingCompleted` is `false`, the home route (`/`) should redirect to `/onboarding`.

**File:** `src/renderer/src/routes/index.tsx`

```typescript
import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const onboardingDone = await window.config.get('onboardingCompleted')
    if (!onboardingDone) {
      throw redirect({ to: '/onboarding' })
    }
  },
  component: HomeView
})
```

---

## 3. Onboarding Wizard Architecture

### 3.1 Route

**New file:** `src/renderer/src/routes/onboarding/index.tsx`

```typescript
export const Route = createFileRoute('/onboarding')({
  component: OnboardingPage
})

function OnboardingPage(): ReactElement {
  return <OnboardingWizard />
}
```

### 3.2 Component Hierarchy

```
src/renderer/src/components/onboarding/
├── OnboardingWizard.tsx          # Step orchestrator (useReducer)
├── WelcomeStep.tsx               # Welcome screen + skip all
├── ImportStep.tsx                 # Import orchestrator (sub-steps)
│   ├── ImportSourceSelector.tsx   # Choose Apple Notes / Obsidian / Skip
│   ├── ImportTargetSelector.tsx   # New space vs existing space
│   ├── ImportPreview.tsx          # Scan results + confirm
│   └── ImportProgress.tsx         # Progress bar during import
├── ModelDownloadStep.tsx          # AI model download with progress
├── TutorialStep.tsx              # Quick guide cards
│   └── TutorialCard.tsx          # Reusable card component
└── OnboardingComplete.tsx        # Final confirmation + start app
```

### 3.3 State Machine

The wizard is managed by a `useReducer` in `OnboardingWizard.tsx`. This state is **local React state** — not Redux, not persisted. If the user quits mid-onboarding, it restarts from the beginning on next launch.

```typescript
type OnboardingStep = 'welcome' | 'import' | 'models' | 'tutorial' | 'complete'

interface OnboardingState {
  currentStep: OnboardingStep

  import: {
    source: 'apple-notes' | 'obsidian' | null
    sourcePath: string | null
    targetMode: 'new-space' | 'existing-space' | null
    targetSpaceId: string | null
    newSpaceName: string
    newSpaceIcon: string
    scanResult: ImportScanResult | null
    importResult: ImportResult | null
    isImporting: boolean
    skipped: boolean
  }

  models: {
    chatModelDownloaded: boolean
    embeddingModelDownloaded: boolean
    skipped: boolean
  }
}

type OnboardingAction =
  | { type: 'NEXT_STEP' }
  | { type: 'GO_TO_STEP'; step: OnboardingStep }
  | { type: 'SET_IMPORT_SOURCE'; source: 'apple-notes' | 'obsidian' }
  | { type: 'SET_IMPORT_PATH'; path: string }
  | { type: 'SET_IMPORT_TARGET'; mode: 'new-space' | 'existing-space'; spaceId?: string }
  | { type: 'SET_SCAN_RESULT'; result: ImportScanResult }
  | { type: 'SET_IMPORT_RESULT'; result: ImportResult }
  | { type: 'SET_IMPORTING'; value: boolean }
  | { type: 'SKIP_IMPORT' }
  | { type: 'SET_MODEL_STATUS'; chat: boolean; embedding: boolean }
  | { type: 'SKIP_MODELS' }
  | { type: 'COMPLETE' }
```

**Step flow:**
```
welcome ──→ import ──→ models ──→ tutorial ──→ complete
   │           │          │          │
   └── skip ───┴── skip ──┴── skip ──┘──→ complete
```

### 3.4 UI Layout

The wizard occupies the full viewport with centered content. Each step renders inside a container with consistent padding, max-width, and vertical centering.

```typescript
// OnboardingWizard.tsx layout wrapper
<div className="flex h-full flex-col items-center justify-center p-8">
  <div className="w-full max-w-2xl space-y-8">
    {/* Step indicator */}
    <StepIndicator current={state.currentStep} steps={STEPS} />

    {/* Active step component */}
    {renderStep(state.currentStep)}

    {/* Navigation footer */}
    <div className="flex items-center justify-between">
      <Button variant="ghost" onClick={handleSkipAll}>
        Skip setup
      </Button>
      {/* Step-specific primary action rendered by each step */}
    </div>
  </div>
</div>
```

**Step indicator:** A horizontal row of dots or labeled steps using Shadcn components. Each step shows its status (pending, active, completed, skipped) via badge color variants.

---

## 4. Note Import — Architecture

This is the most complex feature. It spans all three processes (main, preload, renderer) and introduces a new subsystem.

### 4.1 Type Definitions

**New file:** `src/main/import/types.ts`

```typescript
export type ImportSource = 'apple-notes' | 'obsidian'

export interface ImportOptions {
  source: ImportSource
  sourcePath: string
  targetMode: 'new-space' | 'existing-space'
  targetSpaceId?: string
  newSpaceName?: string
  newSpaceIcon?: string
}

export interface ImportScanResult {
  source: ImportSource
  totalFiles: number
  folders: string[]           // Folder names found
  sampleTitles: string[]      // First 10 note titles for preview
  totalSizeBytes: number
  hasAttachments: boolean
  warnings: string[]          // e.g., "Full Disk Access required"
}

export interface ImportResult {
  spaceId: string
  totalFiles: number
  importedNotes: number
  importedFolders: number
  importedAttachments: number
  skippedFiles: number
  errors: ImportFileError[]
}

export interface ImportFileError {
  filePath: string
  error: string
}

export interface ImportProgressEvent {
  phase: 'scanning' | 'converting' | 'creating' | 'complete'
  current: number
  total: number
  currentFile: string | null
  status: 'in-progress' | 'complete' | 'error'
  error?: string
}

// Internal: parsed note ready for creation
export interface ParsedNote {
  title: string
  content: string            // Markdown string
  folder: string | null      // Relative folder path (e.g., "Projects/Work")
  createdAt?: string         // ISO timestamp
  updatedAt?: string         // ISO timestamp
  attachments: ParsedAttachment[]
}

export interface ParsedAttachment {
  originalPath: string       // Path in the source
  filename: string           // Original filename
  type: 'images' | 'pdfs' | 'attachments'  // TaacNotes asset type
  data: Buffer               // File content
}
```

### 4.2 Main Process — ImportManager

**New file:** `src/main/import/ImportManager.ts`

The `ImportManager` orchestrates the import pipeline. It follows the singleton pattern with `getInstance()`, consistent with `AIManager`.

```
src/main/import/
├── ImportManager.ts          # Singleton orchestrator
├── types.ts                  # Type definitions
├── index.ts                  # Barrel exports
└── parsers/
    ├── BaseParser.ts         # Abstract base with shared utilities
    ├── AppleNotesParser.ts   # SQLite + protobuf parsing
    └── ObsidianParser.ts     # Vault directory parsing
```

#### ImportManager Core Logic

```typescript
class ImportManager {
  private static instance: ImportManager | null = null
  private constructor() {}

  static getInstance(): ImportManager {
    if (!ImportManager.instance) ImportManager.instance = new ImportManager()
    return ImportManager.instance
  }

  // Phase 1: Scan source for preview
  async scan(sourcePath: string, source: ImportSource): Promise<ImportScanResult>

  // Phase 2: Execute full import
  async runImport(
    options: ImportOptions,
    spaceManager: SpaceManager,
    getOrCreateFsManager: (spaceId: string) => FileSystemManager,
    onProgress: (event: ImportProgressEvent) => void
  ): Promise<ImportResult>
}
```

**`runImport` pipeline:**

```
1. Parse source
   ├── Apple Notes: AppleNotesParser.parse(sourcePath)
   └── Obsidian: ObsidianParser.parse(sourcePath)
   → Result: ParsedNote[]

2. Create target
   ├── new-space: spaceManager.createSpace(name, icon) → spaceId
   └── existing-space: use provided spaceId
   → Get fsManager via getOrCreateFsManager(spaceId)

3. Create folder structure
   └── Deduplicate folder paths from ParsedNote[].folder
   └── Create folders depth-first (parent before child)
   └── Build folderPathToIdMap: Record<string, string>
   → Emit progress: phase='creating', current/total

4. Create notes
   └── For each ParsedNote:
       ├── Resolve folderId from folderPathToIdMap (or 'root' if no folder)
       ├── Copy attachments to {spaceId}/assets/{type}/ via fsManager.saveAsset()
       ├── Rewrite attachment references in content to taac-asset:// URLs
       └── fsManager.createNote(folderId, content, title)
   → Emit progress per note

5. Return ImportResult
```

#### Folder Structure Mapping

Both Apple Notes and Obsidian have hierarchical folder structures. These must be mapped to TaacNotes' flat folder-with-parent model.

Example: Obsidian vault has `Projects/Work/Tasks.md`

```
1. Create folder "Projects" with parentId = 'root' → folderId = 'abc'
2. Create folder "Work" with parentId = 'abc' → folderId = 'def'
3. Create note "Tasks" in folderId = 'def'
```

When importing into an existing space, all content goes under a single root-level folder:
- Apple Notes import → folder named "Apple Notes"
- Obsidian import → folder named "Obsidian"

The import subfolder becomes the new root for the imported hierarchy.

### 4.3 Apple Notes Parser

**New file:** `src/main/import/parsers/AppleNotesParser.ts`

This parser reads Apple Notes directly from the macOS SQLite database. This is the most complex parser.

#### Database Location

```
~/Library/Group Containers/group.com.apple.notes/NoteStore.sqlite
```

Associated files: `NoteStore.sqlite-shm`, `NoteStore.sqlite-wal` (WAL journal).

#### Prerequisites

- **Full Disk Access**: The Electron app needs Full Disk Access permission to read the Notes database. The parser must detect this and return a clear error if permission is missing.
- **Dependencies**:
  - `better-sqlite3` (already in project) — SQLite reader
  - `protobufjs` (new dependency) — Decode protobuf binary data
  - `zlib` (Node.js built-in) — Gunzip compressed note body

#### Database Schema (Relevant Tables)

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `ZICCLOUDSYNCINGOBJECT` | `Z_PK`, `ZTITLE1`, `ZCREATIONDATE1`, `ZMODIFICATIONDATE1`, `ZFOLDER` (FK), `ZACCOUNT` (FK) | Note and folder metadata |
| `ZICNOTEDATA` | `Z_PK`, `ZDATA`, `ZNOTE` (FK to ZICCLOUDSYNCINGOBJECT) | Note body (compressed protobuf) |

#### Note Body Decoding Pipeline

```
ZICNOTEDATA.ZDATA (blob)
  │
  ├── 1. Detect gzip header (0x1F 0x8B)
  │      └── zlib.gunzipSync(data)
  │
  ├── 2. Decode protobuf
  │      └── protobufjs with reverse-engineered schema
  │      └── Key fields:
  │            ├── note_text: string (plain text with U+FFFC for objects)
  │            ├── attribute_run[]: formatting runs (bold, italic, heading, list, etc.)
  │            └── attachment references (for embedded images, tables, drawings)
  │
  ├── 3. Reconstruct Markdown
  │      └── Walk text + attribute_runs simultaneously
  │      └── Apply formatting: heading levels, bold/italic, lists, code blocks
  │      └── Replace U+FFFC placeholders with attachment references
  │
  └── 4. Extract attachments
         └── Query ZICCLOUDSYNCINGOBJECT for attachment metadata
         └── Read files from:
               ~/Library/Group Containers/group.com.apple.notes/
               Accounts/{accountId}/Media/{noteId}/{filename}
```

#### Protobuf Schema

The Apple Notes protobuf schema is not publicly documented by Apple. It has been reverse-engineered by forensics researchers. The key message structure:

```protobuf
// Simplified reverse-engineered schema
message NoteStoreProto {
  message Document {
    message Note {
      string note_text = 2;
      repeated AttributeRun attribute_run = 5;
    }
  }
}

message AttributeRun {
  int32 length = 1;
  // Formatting flags
  optional int32 paragraph_style = 2;  // 0=body, 1=title, 4=heading, 100-102=checklist
  optional int32 font_weight = 5;      // Bold
  optional int32 underlined = 6;
  optional int32 strikethrough = 7;
  optional int32 font_hints = 8;       // Italic
  optional AttachmentInfo attachment_info = 12;
}
```

**Reference implementation:** The [Obsidian Importer](https://github.com/obsidianmd/obsidian-importer) project contains a complete TypeScript Apple Notes parser at `src/formats/apple-notes/`. This should be used as the primary reference for the protobuf schema and decoding logic.

#### Folder Reconstruction

Apple Notes organizes notes in folders within accounts. The folder hierarchy is stored in `ZICCLOUDSYNCINGOBJECT` where items with `ZFOLDER` references link notes to their parent folder. Folder names are in `ZTITLE1`.

```sql
-- Get all folders
SELECT Z_PK, ZTITLE1, ZPARENT
FROM ZICCLOUDSYNCINGOBJECT
WHERE ZTYPEUTI = 'com.apple.notes.folder'

-- Get all notes with their folder
SELECT n.Z_PK, n.ZTITLE1, n.ZCREATIONDATE1, n.ZMODIFICATIONDATE1,
       f.ZTITLE1 as folderName
FROM ZICCLOUDSYNCINGOBJECT n
JOIN ZICCLOUDSYNCINGOBJECT f ON n.ZFOLDER = f.Z_PK
WHERE n.ZTYPEUTI = 'com.apple.note'
```

#### Permission Check

Before attempting to read the database, check if the file is accessible:

```typescript
async checkAccess(): Promise<{ accessible: boolean; error?: string }> {
  const dbPath = join(
    homedir(),
    'Library/Group Containers/group.com.apple.notes/NoteStore.sqlite'
  )

  try {
    await fs.access(dbPath, fs.constants.R_OK)
    return { accessible: true }
  } catch {
    return {
      accessible: false,
      error: 'Full Disk Access is required to read Apple Notes. '
           + 'Go to System Settings > Privacy & Security > Full Disk Access '
           + 'and enable TaacNotes.'
    }
  }
}
```

#### Fallback: Pre-Exported Files

If Full Disk Access is not granted (or the user prefers), offer a fallback path where the user selects a folder of pre-exported `.html` or `.md` files.

For `.html` files, use the `turndown` library to convert HTML to Markdown:

```typescript
import TurndownService from 'turndown'

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced'
})

const markdown = turndown.turndown(htmlContent)
```

**UI flow:** If access check fails, show an alert with:
1. Instructions to grant Full Disk Access
2. A "Retry" button to re-check
3. An alternative "Select exported folder" button for the fallback path

### 4.4 Obsidian Parser

**New file:** `src/main/import/parsers/ObsidianParser.ts`

The Obsidian parser reads a vault directory (any folder containing `.md` files and optionally a `.obsidian/` config folder).

#### Vault Detection

```typescript
async isObsidianVault(dirPath: string): Promise<boolean> {
  // Primary: check for .obsidian/ folder
  const obsidianDir = join(dirPath, '.obsidian')
  try {
    await fs.access(obsidianDir)
    return true
  } catch {
    // Fallback: check if directory contains .md files
    const files = await fs.readdir(dirPath)
    return files.some(f => f.endsWith('.md'))
  }
}
```

#### Parsing Pipeline

```
1. Walk directory recursively
   ├── Skip .obsidian/, .trash/, .git/
   ├── Collect .md files → note candidates
   └── Collect non-.md files → attachment candidates

2. For each .md file:
   ├── Read as UTF-8
   ├── Extract YAML frontmatter (between --- delimiters)
   │     └── Parse title, tags, aliases, date
   ├── Determine title: frontmatter.title || first # heading || filename
   ├── Convert wikilinks to standard markdown
   ├── Convert embeds to standard markdown
   ├── Determine relative folder path
   └── Collect referenced attachments

3. For each referenced attachment:
   ├── Resolve file path (check vault root, same folder, configured subfolder)
   ├── Determine asset type (images/pdfs/attachments)
   └── Read file buffer
```

#### Wikilink Conversion

Obsidian wikilinks must be converted to standard Markdown. Since TaacNotes notes don't have inter-note linking, wikilinks are converted to plain text or simple markers.

```typescript
function convertWikilinks(content: string): string {
  // [[Page Name|Display Text]] → Display Text
  content = content.replace(
    /\[\[([^\]|]+)\|([^\]]+)\]\]/g,
    '$2'
  )

  // [[Page Name]] → Page Name
  content = content.replace(
    /\[\[([^\]]+)\]\]/g,
    '$1'
  )

  return content
}
```

#### Embed Conversion

```typescript
function convertEmbeds(content: string, attachmentMap: Map<string, string>): string {
  // ![[image.png]] → ![image.png](taac-asset://spaceId/images/newId.png)
  // ![[image.png|400]] → ![image.png](taac-asset://spaceId/images/newId.png)
  content = content.replace(
    /!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g,
    (_, filename) => {
      const assetUrl = attachmentMap.get(filename)
      if (assetUrl) return `![${filename}](${assetUrl})`
      return `![${filename}]()`  // Broken reference
    }
  )

  return content
}
```

#### Frontmatter Handling

YAML frontmatter is stripped from the imported content. Key metadata is preserved:

- `title` → Used as note title
- `tags` → Preserved as a `## Tags` section at the bottom (since TaacNotes has no tag system yet)
- `date` / `created` → Used as `createdAt` timestamp
- `aliases` → Ignored (no equivalent in TaacNotes)
- Other fields → Ignored

```typescript
function extractFrontmatter(content: string): {
  frontmatter: Record<string, unknown> | null
  body: string
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return { frontmatter: null, body: content }

  // Parse YAML (use a lightweight YAML parser or regex for simple cases)
  const frontmatter = parseYaml(match[1])
  const body = match[2]

  return { frontmatter, body }
}
```

#### Attachment Resolution

Obsidian stores attachment location configuration in `.obsidian/app.json`:

```json
{
  "attachmentFolderPath": "Attachments"
}
```

The parser should:
1. Read `.obsidian/app.json` if it exists
2. Check `attachmentFolderPath` for attachment location strategy
3. For each `![[filename]]` embed, search for the file in order:
   - Configured attachment folder
   - Same folder as the referencing note
   - Vault root
4. Copy found files to `{spaceId}/assets/{type}/` via `fsManager.saveAsset()`
5. Generate `taac-asset://{spaceId}/{type}/{newFilename}` URL
6. Build `attachmentMap: Map<originalFilename, taacAssetUrl>` for embed rewriting

### 4.5 IPC Channels

**New file:** `src/main/ipc/importHandlers.ts`

```typescript
import { ipcMain, dialog, BrowserWindow } from 'electron'
import type { SpaceManager } from '../utils/spaceManager'
import type { FileSystemManager } from '../utils/fileSystem'
import { ImportManager } from '../import/ImportManager'
import type { ImportSource, ImportOptions } from '../import/types'

type GetFsManager = (spaceId: string) => FileSystemManager

export function registerImportHandlers(
  spaceManager: SpaceManager,
  getOrCreateFsManager: GetFsManager
): void {
  const importManager = ImportManager.getInstance()

  // Open native folder picker
  ipcMain.handle('import:selectFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select folder to import',
      message: 'Choose a folder containing your notes'
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // Scan source for preview (non-destructive)
  ipcMain.handle(
    'import:scan',
    async (_event, sourcePath: string, source: ImportSource) => {
      try {
        return await importManager.scan(sourcePath, source)
      } catch (error) {
        throw new Error(
          `Failed to scan import source: ${(error as Error).message}`
        )
      }
    }
  )

  // Apple Notes: check database access permission
  ipcMain.handle('import:checkAppleNotesAccess', async () => {
    try {
      return await importManager.checkAppleNotesAccess()
    } catch (error) {
      throw new Error(
        `Failed to check Apple Notes access: ${(error as Error).message}`
      )
    }
  })

  // Execute full import
  ipcMain.handle(
    'import:start',
    async (event, options: ImportOptions) => {
      try {
        const result = await importManager.runImport(
          options,
          spaceManager,
          getOrCreateFsManager,
          (progressEvent) => {
            // Forward progress to all windows
            BrowserWindow.getAllWindows().forEach((win) => {
              if (!win.webContents.isDestroyed()) {
                win.webContents.send('import:progress', progressEvent)
              }
            })
          }
        )
        return result
      } catch (error) {
        throw new Error(
          `Import failed: ${(error as Error).message}`
        )
      }
    }
  )
}
```

**Registration in `src/main/index.ts`:**

```typescript
import { registerImportHandlers } from './ipc/importHandlers'

// Inside app.whenReady():
registerImportHandlers(spaceManager, getOrCreateFsManager)
```

### 4.6 Preload Bridge

**File:** `src/preload/index.ts` — Add new `importAPI` namespace:

```typescript
const importAPI = {
  selectFolder: (): Promise<string | null> =>
    ipcRenderer.invoke('import:selectFolder'),

  scan: (sourcePath: string, source: ImportSource): Promise<ImportScanResult> =>
    ipcRenderer.invoke('import:scan', sourcePath, source),

  checkAppleNotesAccess: (): Promise<{ accessible: boolean; error?: string }> =>
    ipcRenderer.invoke('import:checkAppleNotesAccess'),

  start: (options: ImportOptions): Promise<ImportResult> =>
    ipcRenderer.invoke('import:start', options),

  onProgress: (callback: (event: ImportProgressEvent) => void): (() => void) => {
    const handler = (_: unknown, event: ImportProgressEvent): void => callback(event)
    ipcRenderer.on('import:progress', handler)
    return (): void => {
      ipcRenderer.removeListener('import:progress', handler)
    }
  }
}

// Expose via contextBridge
contextBridge.exposeInMainWorld('import', importAPI)
```

**File:** `src/preload/index.d.ts` — Add type declaration:

```typescript
interface ImportAPI {
  selectFolder(): Promise<string | null>
  scan(sourcePath: string, source: ImportSource): Promise<ImportScanResult>
  checkAppleNotesAccess(): Promise<{ accessible: boolean; error?: string }>
  start(options: ImportOptions): Promise<ImportResult>
  onProgress(callback: (event: ImportProgressEvent) => void): () => void
}

interface Window {
  // ... existing APIs
  import: ImportAPI
}
```

### 4.7 Renderer Hooks

**New file:** `src/renderer/src/hooks/useImport.ts`

```typescript
import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ImportSource, ImportOptions, ImportScanResult, ImportResult, ImportProgressEvent } from '@main/import/types'

export function useSelectImportFolder() {
  return useMutation({
    mutationFn: () => window.import.selectFolder()
  })
}

export function useCheckAppleNotesAccess() {
  return useMutation({
    mutationFn: () => window.import.checkAppleNotesAccess()
  })
}

export function useScanImport() {
  return useMutation({
    mutationFn: ({ sourcePath, source }: { sourcePath: string; source: ImportSource }) =>
      window.import.scan(sourcePath, source)
  })
}

export function useStartImport() {
  const [progress, setProgress] = useState<ImportProgressEvent | null>(null)
  const queryClient = useQueryClient()

  useEffect(() => {
    const unsubscribe = window.import.onProgress((event) => {
      setProgress(event)
      if (event.status === 'complete' || event.status === 'error') {
        // Clear progress after a delay for UI transition
        setTimeout(() => setProgress(null), 2000)
      }
    })
    return unsubscribe
  }, [])

  const mutation = useMutation({
    mutationFn: (options: ImportOptions) => window.import.start(options),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['spaces'] })
    }
  })

  return { ...mutation, progress }
}
```

### 4.8 Import Step UI Flow

The import step is a multi-sub-step flow within the wizard:

```
┌─────────────────────────────────────────────────┐
│  Import Source Selection                         │
│                                                  │
│  ┌──────────────┐  ┌──────────────┐             │
│  │  Apple Notes  │  │   Obsidian   │             │
│  │  [apple icon] │  │ [vault icon] │             │
│  │              │  │              │              │
│  │  Import from │  │  Import from │              │
│  │  macOS Notes │  │  Obsidian    │              │
│  │  app         │  │  vault       │              │
│  └──────────────┘  └──────────────┘             │
│                                                  │
│  [Skip import]                                   │
└─────────────────────────────────────────────────┘
```

**Sub-step 1 — Source selection** (`ImportSourceSelector.tsx`):
- Two large cards: Apple Notes and Obsidian
- Each card shows icon, source name, brief description
- "Skip import" ghost button at the bottom
- Clicking a card advances to sub-step 2

**Sub-step 2 — Apple Notes: Permission check + auto-scan**:
- Automatically check `import:checkAppleNotesAccess`
- If accessible: auto-run `import:scan` with the DB path, show loading state
- If not accessible: show alert with Full Disk Access instructions + "Retry" button + "Select exported folder" fallback
- Fallback triggers `import:selectFolder` native dialog, then `import:scan`

**Sub-step 2 — Obsidian: Folder selection + scan**:
- Trigger `import:selectFolder` (native directory picker)
- Run `import:scan` on selected path
- Show loading spinner during scan

**Sub-step 3 — Target selection** (`ImportTargetSelector.tsx`):
- Two options:
  - "Create new space" — input for space name (pre-filled with "Apple Notes" or "Obsidian"), icon picker
  - "Add to existing space" — dropdown of existing spaces (reuse `useSpaces()` hook)
- If adding to existing space, notes go into a folder named after the source

**Sub-step 4 — Preview + confirm** (`ImportPreview.tsx`):
- Show scan results: total files, folders found, sample note titles
- Show target: "Creating space 'Obsidian'" or "Importing into 'Personal' > 'Obsidian'"
- Show warnings (e.g., "3 files could not be parsed")
- Show estimated size
- "Start Import" primary button

**Sub-step 5 — Progress** (`ImportProgress.tsx`):
- Progress bar (Shadcn `Progress` component)
- Phase indicator: "Scanning files..." → "Converting notes..." → "Creating notes..."
- Current file name
- Count: "45 / 120 notes imported"
- On complete: summary card with results + "Continue" button

### 4.9 Import Target Modes — Detailed Behavior

#### New Space Mode

1. Call `window.space.create(name, icon)` → returns new `Space` with `spaceId`
2. Set as active space: `window.config.set('activeSpaceId', spaceId)`
3. Redux: `dispatch(switchActiveSpace(spaceId))`
4. Redux: `dispatch(loadTree({ spaceId }))`
5. Proceed with import into this space (folders at root level)

#### Existing Space Mode

1. Use the user-selected `spaceId`
2. Create a root-level folder with import source name:
   - `window.fileSystem.createFolder('Apple Notes', 'root')` → returns `FolderMetadata`
   - All imported content nests under this folder
3. Redux: refresh tree if this is the active space

---

## 5. Model Download Step

### 5.1 Component: `ModelDownloadStep.tsx`

This step reuses the existing model download infrastructure entirely. No new main-process code is needed.

**Existing hooks to reuse:**
- `useHardwareInfo()` — from `src/renderer/src/hooks/useHardware.ts`
- `useModelDownload()` — from `src/renderer/src/hooks/useModels.ts`
- `useDownloadedModels()` — from `src/renderer/src/hooks/useModels.ts` (TanStack Query: `['ai', 'models', 'downloaded']`)

**Models to download:**

| Model | ID | Size | Purpose |
|-------|-----|------|---------|
| Qwen3 4B Instruct | `qwen3-4b-instruct-2507-q8` | ~4.3 GB | Primary LLM for AI chat |
| Nomic Embed Text v2 | `nomic-embed-text-v2-moe` | ~512 MB | Note indexing and semantic search |

### 5.2 UI Design

```
┌──────────────────────────────────────────────────────┐
│  Set Up AI Models                                    │
│                                                      │
│  TaacNotes uses local AI models for chat and         │
│  semantic search. Download them now to unlock         │
│  the full experience.                                │
│                                                      │
│  Your hardware: Medium tier (16 GB RAM, Apple M2)    │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │  🤖 Qwen3 4B — AI Chat Model                  │  │
│  │  4.3 GB · Powers the AI assistant              │  │
│  │                                                │  │
│  │  [███████████░░░░░░░░░░] 55%                   │  │
│  │  2.4 GB / 4.3 GB · 15 MB/s · ~2 min left      │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │  🔍 Nomic Embed v2 — Search Model             │  │
│  │  512 MB · Powers semantic note search          │  │
│  │                                                │  │
│  │  [████████████████████████████████] Complete ✓  │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  Total download: ~4.8 GB                             │
│                                                      │
│  [Skip for now]                   [Download All]     │
└──────────────────────────────────────────────────────┘
```

### 5.3 Behavior

1. **On step entry:** Query `useDownloadedModels()` to check if models are already downloaded
2. **If already downloaded:** Show "Already downloaded" badges, "Continue" button instead of "Download All"
3. **"Download All" clicked:** Trigger both downloads in parallel:
   ```typescript
   download('qwen3-4b-instruct-2507-q8')
   download('nomic-embed-text-v2-moe')
   ```
4. **Progress display:** Use `progress` map from `useModelDownload()` to show per-model progress (percentage, speed, ETA via existing `DownloadProgress` type)
5. **Pause/Resume:** Each model card shows a pause button during download (reuses existing `pause(modelId)` / `resume(modelId)` from the hook)
6. **On completion:** Both cards show checkmarks, "Continue" button becomes active
7. **"Skip for now":** Advances to next step. Models can be downloaded later from Settings > AI (`/settings/ai`)

### 5.4 Format Helpers

Extract existing formatting functions from `src/renderer/src/components/ai/ModelCard.tsx` into a shared utility:

**New file:** `src/renderer/src/lib/format.ts`

```typescript
export function formatSize(bytes: number): string { ... }
export function formatSpeed(bytesPerSec: number): string { ... }
export function formatETA(seconds: number): string { ... }
```

These are already implemented inline in `ModelCard.tsx` — extract them for reuse in both `ModelCard` and `ModelDownloadStep`.

---

## 6. Tutorial Step

### 6.1 Component: `TutorialStep.tsx`

A set of 4 concise, static cards that introduce the core TaacNotes concepts. No interactive walkthroughs — just clear, scannable information.

### 6.2 Tutorial Cards

Each card uses the Shadcn `Card` component with a Lucide icon, title, and 2-3 sentences.

| # | Icon | Title | Content |
|---|------|-------|---------|
| 1 | `FileText` | **Writing Notes** | Create notes with the rich Markdown editor. Organize them into folders within your spaces. Notes auto-save as you type. |
| 2 | `Layout` | **Spaces** | Spaces keep your notes organized by project, topic, or context. You can create up to 5 spaces, each completely isolated. Switch between them from the sidebar. |
| 3 | `Bot` | **AI Assistant** | Load an AI model and open the chat panel (Cmd+Shift+A) to ask questions, get summaries, and brainstorm — all powered by a local LLM running on your machine. No data leaves your device. |
| 4 | `Search` | **Smart Search** | Your notes are automatically indexed for semantic search. The embedding model understands meaning, not just keywords — so searching "vacation plans" finds notes about "trip to Italy" too. |

### 6.3 Layout

```
┌──────────────────────────────────────────────────────┐
│  Get to Know TaacNotes                               │
│                                                      │
│  ┌────────────────────┐  ┌────────────────────┐     │
│  │ 📝 Writing Notes   │  │ 📁 Spaces          │     │
│  │                    │  │                    │      │
│  │ Create notes with  │  │ Spaces keep your   │     │
│  │ the rich Markdown  │  │ notes organized by  │     │
│  │ editor...          │  │ project...          │     │
│  └────────────────────┘  └────────────────────┘     │
│                                                      │
│  ┌────────────────────┐  ┌────────────────────┐     │
│  │ 🤖 AI Assistant    │  │ 🔍 Smart Search    │     │
│  │                    │  │                    │      │
│  │ Load an AI model   │  │ Notes are auto-    │     │
│  │ and open the chat  │  │ indexed for        │     │
│  │ panel...           │  │ semantic search... │      │
│  └────────────────────┘  └────────────────────┘     │
│                                                      │
│                              [Get Started →]         │
└──────────────────────────────────────────────────────┘
```

A 2x2 grid of cards using TailwindCSS grid:

```tsx
<div className="grid grid-cols-2 gap-4">
  {tutorialCards.map(card => (
    <TutorialCard key={card.title} {...card} />
  ))}
</div>
```

### 6.4 Component: `TutorialCard.tsx`

```typescript
interface TutorialCardProps {
  icon: LucideIcon
  title: string
  description: string
}

export const TutorialCard: FC<TutorialCardProps> = ({ icon: Icon, title, description }) => (
  <Card className="p-6">
    <div className="mb-3 flex items-center gap-3">
      <div className="rounded-lg bg-primary/10 p-2">
        <Icon className="size-5 text-primary" />
      </div>
      <CardTitle className="text-base">{title}</CardTitle>
    </div>
    <CardDescription className="text-sm leading-relaxed">
      {description}
    </CardDescription>
  </Card>
)
```

---

## 7. Onboarding Complete Step

### 7.1 Component: `OnboardingComplete.tsx`

The final step provides a summary and a call-to-action to start using the app.

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│              ✅ You're all set!                       │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │  Summary                                       │  │
│  │                                                │  │
│  │  📥 Imported: 47 notes in 5 folders            │  │
│  │  🤖 Models: Qwen3 4B + Nomic Embed downloaded  │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  Your notes are ready and AI is set up.              │
│  Start writing, searching, and exploring.            │
│                                                      │
│                    [Start Using TaacNotes →]          │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### 7.2 Completion Logic

When the user clicks "Start Using TaacNotes":

```typescript
const handleComplete = async (): Promise<void> => {
  // 1. Mark onboarding as done
  await window.config.set('onboardingCompleted', true)

  // 2. Ensure at least one space exists (safety net)
  const spaces = await window.space.list()
  if (spaces.length === 0) {
    await window.space.create('Personal', 'Home')
  }

  // 3. Set active space if not set
  const activeSpaceId = await window.config.get('activeSpaceId')
  if (!activeSpaceId) {
    const currentSpaces = await window.space.list()
    if (currentSpaces.length > 0) {
      await window.config.set('activeSpaceId', currentSpaces[0].id)
    }
  }

  // 4. Navigate to home
  navigate({ to: '/' })
}
```

---

## 8. Skip and Resume Behavior

### 8.1 Skip Behavior

| Action | Result |
|--------|--------|
| "Skip setup" on welcome | Sets `onboardingCompleted: true`, creates "Personal" space if none exist, navigates to `/` |
| "Skip import" on import step | Advances to model download step, no notes imported |
| "Skip for now" on model step | Advances to tutorial step, models not downloaded |
| "Get Started" on tutorial | Sets `onboardingCompleted: true`, navigates to `/` |

### 8.2 Resume After Quit

If the user quits the app during onboarding:
- `onboardingCompleted` remains `false`
- On next launch, the redirect in `/` sends them back to `/onboarding`
- The wizard starts from the beginning (welcome step)
- **Model downloads**: Automatically resume from `.part` files (handled by `ModelDownloader`)
- **Partially imported notes**: Remain in the space. If the user runs import again, new notes are created (no deduplication)

### 8.3 Re-Running Import

The import feature is accessible only during onboarding in this iteration. A future enhancement can expose it from Settings for re-import or importing from additional sources.

---

## 9. Error Handling

### 9.1 Import Errors

Import errors are **per-file and non-fatal**. The pipeline continues processing remaining files.

```typescript
// In ImportManager.runImport():
for (const file of files) {
  try {
    const parsed = await parser.parseFile(file)
    await createNote(parsed)
    importedCount++
  } catch (error) {
    errors.push({
      filePath: file.relativePath,
      error: (error as Error).message
    })
    skippedCount++
  }
}
```

**UI display:** After import completes, `ImportProgress.tsx` shows:
- Success count: "45 notes imported"
- Error count (if any): "3 files skipped" with expandable error details

### 9.2 Apple Notes Permission Error

If Full Disk Access is not granted:
- `checkAppleNotesAccess()` returns `{ accessible: false, error: '...' }`
- UI shows an `Alert` component (Shadcn) with:
  - Clear instructions to grant permission
  - Link to open System Settings (via `window.electron.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles')`)
  - "Retry" button
  - "Use exported files instead" fallback

### 9.3 Model Download Errors

Handled by existing `useModelDownload()` hook which exposes error state per model. The `ModelDownloadStep` shows:
- Error message in a destructive `Alert` variant
- "Retry" button that calls `download(modelId)` again

### 9.4 Catastrophic Errors

If the entire import fails (disk full, permissions), the IPC handler throws and the mutation's `onError` callback fires:

```typescript
const { mutate: startImport } = useStartImport()

startImport(options, {
  onError: (error) => {
    toast.error(`Import failed: ${error.message}`)
  }
})
```

---

## 10. New Dependencies

| Package | Version | Purpose | Size | Process |
|---------|---------|---------|------|---------|
| `turndown` | ^7.x | HTML-to-Markdown conversion (Apple Notes fallback) | ~15 KB | Main |
| `@types/turndown` | ^5.x | TypeScript types for turndown | Dev only | — |
| `protobufjs` | ^7.x | Decode Apple Notes protobuf binary data | ~150 KB | Main |

No new renderer dependencies. The `zlib` module for gzip decompression is a Node.js built-in.

---

## 11. File Inventory

### New Files

```
src/main/import/
├── types.ts                          # Import type definitions
├── ImportManager.ts                  # Singleton orchestrator
├── index.ts                          # Barrel exports
└── parsers/
    ├── BaseParser.ts                 # Abstract base with shared utilities
    ├── AppleNotesParser.ts           # SQLite + protobuf + gzip parsing
    └── ObsidianParser.ts             # Vault directory + wikilink conversion

src/main/ipc/
└── importHandlers.ts                 # IPC handler registration

src/renderer/src/hooks/
└── useImport.ts                      # Import hooks (select, scan, start, progress)

src/renderer/src/lib/
└── format.ts                         # Extracted format helpers (size, speed, ETA)

src/renderer/src/routes/onboarding/
└── index.tsx                         # Onboarding route

src/renderer/src/components/onboarding/
├── OnboardingWizard.tsx              # Step orchestrator + useReducer
├── WelcomeStep.tsx                   # Welcome screen
├── ImportStep.tsx                    # Import flow orchestrator
├── ImportSourceSelector.tsx          # Choose Apple Notes / Obsidian
├── ImportTargetSelector.tsx          # New space vs existing space
├── ImportPreview.tsx                 # Scan results + confirm
├── ImportProgress.tsx                # Progress during import
├── ModelDownloadStep.tsx             # AI model download
├── TutorialStep.tsx                  # Quick tutorial (4 cards)
├── TutorialCard.tsx                  # Reusable tutorial card
└── OnboardingComplete.tsx            # Summary + start app
```

### Modified Files

| File | Change |
|------|--------|
| `src/main/utils/configStore.ts` | Add `onboardingCompleted: boolean` to AppConfig interface and schema |
| `src/main/index.ts` | Register `importHandlers`, guard default space creation on `onboardingCompleted` |
| `src/preload/index.ts` | Add `importAPI` namespace, expose as `window.import` |
| `src/preload/index.d.ts` | Add `ImportAPI` interface and `Window.import` declaration |
| `src/preload/types.ts` | Re-export import types needed by renderer |
| `src/renderer/src/routes/__root.tsx` | Conditional layout: minimal for onboarding, full for normal use |
| `src/renderer/src/routes/index.tsx` | Add `beforeLoad` redirect to `/onboarding` if not completed |
| `src/renderer/src/components/ai/ModelCard.tsx` | Extract format helpers to `src/renderer/src/lib/format.ts` |

---

## 12. Implementation Sequence

### Phase 1: Infrastructure (Main Process)

1. Add `onboardingCompleted` to config schema (`configStore.ts`)
2. Create `src/main/import/types.ts`
3. Create `src/main/import/parsers/BaseParser.ts`
4. Create `src/main/import/parsers/ObsidianParser.ts`
5. Install `turndown`, `protobufjs` dependencies
6. Create `src/main/import/parsers/AppleNotesParser.ts`
7. Create `src/main/import/ImportManager.ts`
8. Create `src/main/ipc/importHandlers.ts`
9. Register import handlers in `src/main/index.ts`
10. Modify default space creation guard in `src/main/index.ts`

### Phase 2: Preload Layer

11. Add `importAPI` to `src/preload/index.ts`
12. Add `ImportAPI` interface to `src/preload/index.d.ts`
13. Add/re-export import types in `src/preload/types.ts`

### Phase 3: Renderer — Hooks and Utilities

14. Create `src/renderer/src/hooks/useImport.ts`
15. Extract format helpers to `src/renderer/src/lib/format.ts`

### Phase 4: Renderer — Onboarding Components

16. Create `OnboardingWizard.tsx` with step state machine
17. Create `WelcomeStep.tsx`
18. Create `ImportSourceSelector.tsx`
19. Create `ImportTargetSelector.tsx`
20. Create `ImportPreview.tsx`
21. Create `ImportProgress.tsx`
22. Create `ImportStep.tsx` (orchestrates sub-components)
23. Create `ModelDownloadStep.tsx`
24. Create `TutorialCard.tsx`
25. Create `TutorialStep.tsx`
26. Create `OnboardingComplete.tsx`

### Phase 5: Integration

27. Create onboarding route `src/renderer/src/routes/onboarding/index.tsx`
28. Modify `__root.tsx` for conditional layout
29. Add redirect in `src/renderer/src/routes/index.tsx`
30. Wire completion logic: set config, ensure space, navigate

### Phase 6: Testing and Polish

31. Test with real Obsidian vault (various sizes, with attachments)
32. Test with Apple Notes database (requires Full Disk Access)
33. Test fallback path with exported .html/.md files
34. Test skip flows (skip all, skip individual steps)
35. Test quit-and-resume (quit at each step, relaunch)
36. Test model download progress and pause/resume during onboarding
37. Run `pnpm typecheck` and `pnpm lint`
