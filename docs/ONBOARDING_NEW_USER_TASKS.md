# TaacNotes — Onboarding Implementation Tasks

This document breaks the onboarding specification (`docs/ONBOARDING_NEW_USER.md`) into ordered, self-contained tasks. Each task includes a prompt for Claude Code. Tasks are grouped by macro functionality and ordered by dependency.

**Reference documents:**
- `docs/ONBOARDING_NEW_USER.md` — Full onboarding specification
- `docs/GENERAL_ARCHITECTURE_RULES.md` — Architecture patterns and coding rules

---

## Overview

### Task Groups

| Group | Name | Tasks | Scope |
|-------|------|-------|-------|
| **A** | Infrastructure & Config | A1, A2 | Config schema, main process guard |
| **B** | Import Subsystem — Core | B1, B2 | Types, BaseParser, ImportManager |
| **C** | Import Subsystem — Parsers | C1, C2 | ObsidianParser, AppleNotesParser |
| **D** | IPC & Preload Bridge | D1 | Import IPC handlers, preload API, type declarations |
| **E** | Renderer Hooks & Utilities | E1, E2 | Import hooks, format helpers extraction |
| **F** | Onboarding UI — Wizard & Simple Steps | F1, F2 | Wizard orchestrator, welcome, tutorial, complete |
| **G** | Onboarding UI — Import Step | G1, G2 | Source/target selectors, preview, progress, orchestrator |
| **H** | Onboarding UI — Model Download | H1 | Model download step |
| **I** | Integration | I1 | Root layout, route redirect, completion wiring |

### Execution Order

```
1.  A1  Config key
2.  B1  Import types + BaseParser
3.  A2  Guard space creation
4.  E2  Extract format helpers
5.  C1  ObsidianParser
6.  C2  AppleNotesParser (install deps first)
7.  B2  ImportManager
8.  D1  IPC + preload bridge
9.  E1  Import hooks
10. F1  Wizard + welcome + route
11. F2  Tutorial + complete steps
12. G1  Import source/target selectors
13. H1  Model download step
14. G2  Import preview/progress/step orchestrator
15. I1  Root layout + route redirect
```

### Dependency Graph

```
A1 (config key)
 ├──→ A2 (guard space creation)
 └──→ F1 (wizard + welcome + route)
       ├──→ F2 (tutorial + complete)
       │     └──→ I1 (integration)
       ├──→ G1 (import source/target)
       │     └──→ G2 (import preview/progress/step)
       └──→ H1 (model download step)

B1 (import types + BaseParser)
 ├──→ B2 (ImportManager)
 │     └──→ D1 (IPC + preload bridge)
 │           └──→ E1 (import hooks)
 │                 └──→ G1, G2
 ├──→ C1 (ObsidianParser)
 └──→ C2 (AppleNotesParser)

E2 (format helpers) ──→ H1 (model download step)
```

---

## Group A — Infrastructure & Config

### Task A1: Add `onboardingCompleted` to Config Schema

**Spec reference:** `docs/ONBOARDING_NEW_USER.md` Section 2.1
**Dependencies:** None (first task)
**Files to modify:** `src/main/utils/configStore.ts`, `src/preload/types.ts`

#### Prompt

```
Implement the `onboardingCompleted` config key as specified in `docs/ONBOARDING_NEW_USER.md` Section 2.1.

Architecture rules: Follow `docs/GENERAL_ARCHITECTURE_RULES.md` Section 10 for TypeScript conventions.

Files to modify:

1. `src/main/utils/configStore.ts` — Add `onboardingCompleted: boolean` to the `AppConfig` interface (after `spacesInitialized`). Add matching entry to the `schema` object with `{ type: 'boolean', default: false }`.

2. `src/preload/types.ts` — Add `onboardingCompleted: boolean` to the duplicate `AppConfig` interface (after `spacesInitialized`). This interface must stay in sync with `configStore.ts`.

Existing patterns to follow:
- Look at how `spacesInitialized: boolean` is declared in both files — `onboardingCompleted` follows the exact same pattern.
- The schema uses JSON Schema format with `type` and `default` properties.

Output expectations:
- Both `AppConfig` interfaces contain `onboardingCompleted: boolean`.
- The schema object contains the new key with `type: 'boolean'` and `default: false`.
- Run `pnpm typecheck` to verify no regressions.
```

---

### Task A2: Guard Default Space Creation

**Spec reference:** `docs/ONBOARDING_NEW_USER.md` Section 2.2
**Dependencies:** A1
**Files to modify:** `src/main/index.ts`

#### Prompt

```
Guard the automatic "Personal" space creation in the main process as specified in `docs/ONBOARDING_NEW_USER.md` Section 2.2.

Architecture rules: Follow `docs/GENERAL_ARCHITECTURE_RULES.md` Section 3 for main process patterns.

File to modify: `src/main/index.ts`

At lines 127-132, the app currently auto-creates a "Personal" space when no spaces exist:

    const spaces = await spaceManager.listSpaces()
    if (spaces.length === 0) {
      await spaceManager.createSpace('Personal', 'Home')
      configStore.set('spacesInitialized', true)
    }

Change this so it only auto-creates when `onboardingCompleted` is `true` (post-onboarding safety net for users who deleted all spaces):

    const spaces = await spaceManager.listSpaces()
    const onboardingDone = configStore.get('onboardingCompleted')
    if (spaces.length === 0 && onboardingDone) {
      await spaceManager.createSpace('Personal', 'Home')
      configStore.set('spacesInitialized', true)
    }

Existing code context: The `configStore` import already exists at the top of the file. The `spaceManager` is initialized before this block. The active space logic that follows should remain unchanged.

Output expectations:
- The default space is NOT created for first-run users (onboardingCompleted is false by default).
- The default space IS created for post-onboarding users who somehow have 0 spaces.
- Run `pnpm typecheck:node` to verify.
```

---

## Group B — Import Subsystem Core

### Task B1: Import Type Definitions and BaseParser

**Spec reference:** `docs/ONBOARDING_NEW_USER.md` Sections 4.1, 4.2
**Dependencies:** None
**Files to create:** `src/main/import/types.ts`, `src/main/import/parsers/BaseParser.ts`, `src/main/import/index.ts`

#### Prompt

```
Create the foundational import subsystem type definitions and abstract base parser as specified in `docs/ONBOARDING_NEW_USER.md` Sections 4.1 and 4.2.

Architecture rules: Follow `docs/GENERAL_ARCHITECTURE_RULES.md` Section 10 for TypeScript conventions (interfaces for object shapes, types for unions). Section 3.3 for idempotent initialization.

Files to create:

1. `src/main/import/types.ts` — Define all types exactly as specified in the spec Section 4.1:
   - `ImportSource` (type alias: 'apple-notes' | 'obsidian')
   - `ImportOptions` (interface: source, sourcePath, targetMode, targetSpaceId?, newSpaceName?, newSpaceIcon?)
   - `ImportScanResult` (interface: source, totalFiles, folders[], sampleTitles[], totalSizeBytes, hasAttachments, warnings[])
   - `ImportResult` (interface: spaceId, totalFiles, importedNotes, importedFolders, importedAttachments, skippedFiles, errors[])
   - `ImportFileError` (interface: filePath, error)
   - `ImportProgressEvent` (interface: phase, current, total, currentFile, status, error?)
   - `ParsedNote` (interface: title, content, folder, createdAt?, updatedAt?, attachments[])
   - `ParsedAttachment` (interface: originalPath, filename, type, data as Buffer)
   Use explicit interfaces (not types) for all object shapes. Use `Buffer` for `ParsedAttachment.data`.

2. `src/main/import/parsers/BaseParser.ts` — Abstract class with:
   - `abstract scan(sourcePath: string): Promise<ImportScanResult>` — Preview scan
   - `abstract parse(sourcePath: string): Promise<ParsedNote[]>` — Full parse
   - Protected helper: `determineAssetType(filename: string): 'images' | 'pdfs' | 'attachments'` — Map file extensions to TaacNotes asset categories (.png/.jpg/.jpeg/.gif/.webp/.svg/.bmp = images, .pdf = pdfs, everything else = attachments)
   - Protected helper: `generateSafeFilename(original: string): string` — Prepend UUID to prevent collisions
   - Use `[ClassName]` logging convention per architecture rules Section 3.7

3. `src/main/import/index.ts` — Barrel file exporting all types and BaseParser.

Existing patterns: Look at `src/main/ai/types.ts` for how AI types are structured. Look at `src/main/ai/AIManager.ts` for singleton/abstract class conventions.

Output expectations:
- All interfaces have explicit types, no `any`.
- `ParsedAttachment.type` uses `'images' | 'pdfs' | 'attachments'` matching the TaacNotes asset folder structure (see `src/main/utils/fileSystem.ts` saveAsset method).
- Run `pnpm typecheck:node` to verify.
```

---

### Task B2: ImportManager Singleton

**Spec reference:** `docs/ONBOARDING_NEW_USER.md` Section 4.2 (ImportManager Core Logic, runImport pipeline)
**Dependencies:** B1, C1, C2 (parsers ideally exist but can use lazy loading)
**Files to create:** `src/main/import/ImportManager.ts`
**Files to modify:** `src/main/import/index.ts`

#### Prompt

```
Create the `ImportManager` singleton orchestrator as specified in `docs/ONBOARDING_NEW_USER.md` Section 4.2 (ImportManager Core Logic and runImport pipeline).

Architecture rules: Follow `docs/GENERAL_ARCHITECTURE_RULES.md` Section 3.1 (singleton pattern), Section 3.3 (idempotent initialization), Section 3.7 (logging convention with `[ImportManager]` prefix).

File to create: `src/main/import/ImportManager.ts`

The ImportManager follows the singleton pattern (private constructor + `getInstance()`) consistent with `AIManager` in `src/main/ai/AIManager.ts`.

Key methods:

1. `scan(sourcePath: string, source: ImportSource): Promise<ImportScanResult>` — Instantiate the correct parser (ObsidianParser or AppleNotesParser) based on source and call `parser.scan()`.

2. `checkAppleNotesAccess(): Promise<{ accessible: boolean; error?: string }>` — Delegate to AppleNotesParser static method. Check if the Apple Notes SQLite DB at `~/Library/Group Containers/group.com.apple.notes/NoteStore.sqlite` is readable.

3. `runImport(options, spaceManager, getOrCreateFsManager, onProgress): Promise<ImportResult>` — The full pipeline:
   a. Parse source via the correct parser → `ParsedNote[]`
   b. Create or resolve target space:
      - new-space: `spaceManager.createSpace(name, icon)` → spaceId
      - existing-space: use provided spaceId
   c. Get fsManager via `getOrCreateFsManager(spaceId)`
   d. Create folder structure depth-first using `fsManager.createFolder()`:
      - Deduplicate folder paths from ParsedNote[].folder
      - Create parents before children
      - Build `folderPathToIdMap: Record<string, string>`
      - For existing-space mode: create a root-level container folder named after the source ("Apple Notes" or "Obsidian")
   e. Create notes: for each ParsedNote:
      - Resolve folderId from folderPathToIdMap (or 'root' if no folder)
      - Copy attachments via `fsManager.saveAsset(filename, buffer, type)` → get asset URL
      - Rewrite attachment references in content to `taac-asset://` URLs
      - Call `fsManager.createNote(folderId, content, title)`
   f. Emit progress events via `onProgress` callback at each phase (scanning, converting, creating, complete)
   g. Handle per-file errors non-fatally: catch, record in errors array, continue

Method signatures (types from `./types`):
- SpaceManager from `../utils/spaceManager` (type-only import)
- FileSystemManager from `../utils/fileSystem` (type-only import)

Import the parsers with lazy instantiation so the file compiles even if parser files are stubbed:
    private getParser(source: ImportSource): BaseParser {
      if (source === 'obsidian') return new ObsidianParser()
      return new AppleNotesParser()
    }

Also update: `src/main/import/index.ts` to re-export `ImportManager`.

Output expectations:
- Singleton pattern with `getInstance()`.
- The `runImport` method handles both new-space and existing-space modes.
- Per-file errors are caught and accumulated in `ImportResult.errors`.
- Progress events are emitted at each phase.
- Run `pnpm typecheck:node` to verify.
```

---

## Group C — Import Parsers

### Task C1: ObsidianParser

**Spec reference:** `docs/ONBOARDING_NEW_USER.md` Section 4.4 (full section)
**Dependencies:** B1
**Files to create:** `src/main/import/parsers/ObsidianParser.ts`

#### Prompt

```
Create the Obsidian vault parser as specified in `docs/ONBOARDING_NEW_USER.md` Section 4.4.

Architecture rules: Follow `docs/GENERAL_ARCHITECTURE_RULES.md` Section 3.7 (logging convention with `[ObsidianParser]` prefix).

File to create: `src/main/import/parsers/ObsidianParser.ts`

The parser extends `BaseParser` from `./BaseParser.ts` and implements `scan()` and `parse()`.

Key features:

1. Vault detection (`isObsidianVault`): Check for `.obsidian/` directory, fallback to checking for `.md` files in the directory.

2. Directory walking: Recursively walk the vault directory. Skip `.obsidian/`, `.trash/`, `.git/` directories. Collect `.md` files as note candidates and non-.md files as attachment candidates.

3. Frontmatter extraction (spec "Frontmatter Handling"): Parse YAML between `---` delimiters. Extract:
   - `title` → note title
   - `tags` → append as `## Tags` section at bottom of body
   - `date` / `created` → `createdAt` timestamp
   - Strip frontmatter from the body content.

4. Wikilink conversion (spec "Wikilink Conversion"):
   - `[[Page Name|Display Text]]` → `Display Text`
   - `[[Page Name]]` → `Page Name`

5. Embed conversion (spec "Embed Conversion"):
   - `![[image.png]]` → `![image.png]()`
   - `![[image.png|400]]` → `![image.png]()`
   Note: Actual asset URL rewriting happens later in ImportManager during note creation.

6. Title resolution: `frontmatter.title` || first `# heading` in body || filename (without `.md`).

7. Folder path: Derived from relative path within vault (e.g., `Projects/Work/Tasks.md` → folder = `Projects/Work`).

8. Attachment resolution (spec "Attachment Resolution"):
   - Read `.obsidian/app.json` for `attachmentFolderPath` if available.
   - For each `![[filename]]` embed, search in order: configured attachment folder, same folder as note, vault root.
   - Read file buffers for found attachments.
   - Use `determineAssetType()` from BaseParser to classify files.

9. Scan method: Walk directory, count .md files, collect folder names, get first 10 note titles, sum file sizes, check for non-.md files (hasAttachments). Return `ImportScanResult`.

Node.js APIs to use: `fs.promises` (readdir, readFile, stat, access), `path` (join, relative, dirname, basename, extname).

Existing patterns: Look at `src/main/utils/fileSystem.ts` for how the project handles filesystem operations with proper error handling.

Output expectations:
- Handles vaults with no `.obsidian/` directory (just a folder of `.md` files).
- Handles nested folder hierarchies of arbitrary depth.
- Wikilinks and embeds are converted correctly.
- Frontmatter is stripped from content.
- Run `pnpm typecheck:node` to verify.
```

---

### Task C2: AppleNotesParser

**Spec reference:** `docs/ONBOARDING_NEW_USER.md` Section 4.3 (full section)
**Dependencies:** B1
**Files to create:** `src/main/import/parsers/AppleNotesParser.ts`
**Files to modify:** `electron.vite.config.ts` (add `protobufjs` to externals)
**Prerequisite command:** `pnpm add protobufjs turndown && pnpm add -D @types/turndown`

#### Prompt

```
Create the Apple Notes parser as specified in `docs/ONBOARDING_NEW_USER.md` Section 4.3. This is the most complex parser.

PREREQUISITES — Run these commands first:
    pnpm add protobufjs turndown
    pnpm add -D @types/turndown
Then add `'protobufjs'` to the externalized deps in `electron.vite.config.ts`:
- In `main.plugins` → `externalizeDepsPlugin({ include: [..., 'protobufjs'] })`
- In `main.build.rollupOptions.external` → add `'protobufjs'` to the array

Architecture rules: Follow `docs/GENERAL_ARCHITECTURE_RULES.md` Section 3.7 (logging convention with `[AppleNotesParser]` prefix).

File to create: `src/main/import/parsers/AppleNotesParser.ts`

The parser extends `BaseParser` and implements `scan()` and `parse()`.

Key features:

1. Permission check (static `checkAccess` method): Verify read access to `~/Library/Group Containers/group.com.apple.notes/NoteStore.sqlite`. Use `os.homedir()` + `fs.promises.access(path, fs.constants.R_OK)`. Return `{ accessible: boolean; error?: string }` with Full Disk Access instructions on failure (as specified in spec "Permission Check").

2. Database reading: Use `better-sqlite3` (already installed and externalized) to open the SQLite database in READONLY mode. Query tables as specified in spec "Database Schema":
   - Folders: `SELECT Z_PK, ZTITLE1, ZPARENT FROM ZICCLOUDSYNCINGOBJECT WHERE ZTYPEUTI = 'com.apple.notes.folder'`
   - Notes with folders: `SELECT n.Z_PK, n.ZTITLE1, n.ZCREATIONDATE1, n.ZMODIFICATIONDATE1, f.ZTITLE1 as folderName FROM ZICCLOUDSYNCINGOBJECT n JOIN ZICCLOUDSYNCINGOBJECT f ON n.ZFOLDER = f.Z_PK WHERE n.ZTYPEUTI = 'com.apple.note'`
   - Note body data: `SELECT ZDATA FROM ZICNOTEDATA WHERE ZNOTE = ?`

3. Note body decoding pipeline (spec "Note Body Decoding Pipeline"):
   a. Detect gzip header (bytes 0x1F 0x8B), decompress with `zlib.gunzipSync()`
   b. Decode protobuf using `protobufjs`. Define the reverse-engineered schema inline (NoteStoreProto → Document → Note with `note_text` string field 2 and `attribute_run[]` repeated field 5). Reference the Obsidian Importer project (https://github.com/obsidianmd/obsidian-importer) `src/formats/apple-notes/` for the full protobuf schema.
   c. Reconstruct Markdown from text + attribute_runs: map paragraph_style values to heading levels, bold, italic, lists, code blocks, checklist items.
   d. Replace U+FFFC (object replacement character) placeholders with attachment references.

4. Attachment extraction: Query ZICCLOUDSYNCINGOBJECT for attachment metadata. Read files from `~/Library/Group Containers/group.com.apple.notes/Accounts/{accountId}/Media/{noteId}/{filename}`.

5. Fallback path (spec "Fallback: Pre-Exported Files"): If database is not accessible, support importing from a user-selected folder of exported `.html` or `.md` files. For `.html` files, use `turndown` for HTML-to-Markdown conversion:
   ```typescript
   import TurndownService from 'turndown'
   const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
   const markdown = turndown.turndown(htmlContent)
   ```

6. Apple date conversion: Core Data timestamps are seconds since 2001-01-01. Convert:
   `new Date((appleTimestamp + 978307200) * 1000).toISOString()`

7. Folder reconstruction: Build folder hierarchy from ZFOLDER/ZPARENT relationships in the database.

Existing patterns: Look at `src/main/ai/VectorDBManager.ts` for how `better-sqlite3` is used in this project (readonly opening, prepared statements, error handling).

Output expectations:
- Handles both direct database access and fallback exported-files paths.
- Core Data timestamps are correctly converted to ISO strings.
- Gzip detection/decompression works.
- Protobuf decoding produces readable Markdown.
- Run `pnpm typecheck:node` to verify.
```

---

## Group D — IPC & Preload Bridge

### Task D1: Import IPC Handlers, Preload Bridge, and Type Declarations

**Spec reference:** `docs/ONBOARDING_NEW_USER.md` Sections 4.5, 4.6
**Dependencies:** B2
**Files to create:** `src/main/ipc/importHandlers.ts`
**Files to modify:** `src/main/index.ts`, `src/preload/index.ts`, `src/preload/index.d.ts`, `src/preload/types.ts`

#### Prompt

```
Wire the import subsystem through the Electron IPC layer as specified in `docs/ONBOARDING_NEW_USER.md` Sections 4.5 and 4.6.

Architecture rules: Follow `docs/GENERAL_ARCHITECTURE_RULES.md` Section 5 (IPC communication patterns), Section 4 (preload layer patterns).

FILES TO CREATE:

1. `src/main/ipc/importHandlers.ts` — Follow the exact pattern from `src/main/ipc/spaceHandlers.ts`:
   - Export `registerImportHandlers(spaceManager: SpaceManager, getOrCreateFsManager: (spaceId: string) => FileSystemManager): void`
   - Register 4 handlers:
     a. `import:selectFolder` — Opens native directory picker via `dialog.showOpenDialog({ properties: ['openDirectory'] })`. Returns selected path or null.
     b. `import:scan` — Takes `(sourcePath: string, source: ImportSource)`. Calls `importManager.scan()`. Returns `ImportScanResult`.
     c. `import:checkAppleNotesAccess` — Calls `importManager.checkAppleNotesAccess()`. Returns `{ accessible: boolean; error?: string }`.
     d. `import:start` — Takes `(options: ImportOptions)`. Calls `importManager.runImport()` with a progress callback that broadcasts to all windows via `BrowserWindow.getAllWindows().forEach(win => win.webContents.send('import:progress', event))`. Returns `ImportResult`.
   - All handlers wrapped in try-catch with contextual error messages.
   - Import `dialog` and `BrowserWindow` from `electron`.

FILES TO MODIFY:

2. `src/main/index.ts` — Add import and call registration:
   - `import { registerImportHandlers } from './ipc/importHandlers'`
   - After the existing handler registrations (line ~154), add: `registerImportHandlers(spaceManager, getOrCreateFsManager)`

3. `src/preload/index.ts` — Add `importAPI` object following the same pattern as `spaceAPI` and `aiAPI`:
   - `selectFolder: () => ipcRenderer.invoke('import:selectFolder')`
   - `scan: (sourcePath, source) => ipcRenderer.invoke('import:scan', sourcePath, source)`
   - `checkAppleNotesAccess: () => ipcRenderer.invoke('import:checkAppleNotesAccess')`
   - `start: (options) => ipcRenderer.invoke('import:start', options)`
   - `onProgress: (callback) => { ... }` — Follow the exact pattern of `onDownloadProgress` in the same file: register `ipcRenderer.on('import:progress', handler)`, return cleanup function that calls `ipcRenderer.removeListener()`.
   - Expose via `contextBridge.exposeInMainWorld('import', importAPI)` in BOTH the `contextIsolated` and fallback branches.

4. `src/preload/index.d.ts` — Add `ImportAPI` interface and update Window:
   - Define `ImportAPI` interface with all 5 method signatures (selectFolder, scan, checkAppleNotesAccess, start, onProgress).
   - Add `import: ImportAPI` to the existing `Window` interface.
   - Use type-only imports for import types from `../main/import/types`.

5. `src/preload/types.ts` — Add type-only re-exports for renderer consumption:
   - `export type { ImportSource, ImportOptions, ImportScanResult, ImportResult, ImportProgressEvent } from '../main/import/types'`

Existing patterns to follow EXACTLY:
- `src/main/ipc/spaceHandlers.ts` for handler registration pattern
- `src/preload/index.ts` lines for `onDownloadProgress` — IPC event listener with cleanup function
- `src/preload/index.d.ts` for API interface declaration pattern

Output expectations:
- All 4 IPC channels are registered and typed.
- The preload bridge correctly wraps all channels.
- The Window interface includes `import: ImportAPI`.
- Run `pnpm typecheck` (both node and web) to verify.
```

---

## Group E — Renderer Hooks & Utilities

### Task E1: Import Hooks

**Spec reference:** `docs/ONBOARDING_NEW_USER.md` Section 4.7
**Dependencies:** D1
**Files to create:** `src/renderer/src/hooks/useImport.ts`

#### Prompt

```
Create the renderer-side import hooks as specified in `docs/ONBOARDING_NEW_USER.md` Section 4.7.

Architecture rules: Follow `docs/GENERAL_ARCHITECTURE_RULES.md` Section 6.4 (custom hooks patterns with TanStack Query).

File to create: `src/renderer/src/hooks/useImport.ts`

Create 4 hooks following the patterns in `src/renderer/src/hooks/useModels.ts` and `src/renderer/src/hooks/useSpaces.ts`:

1. `useSelectImportFolder()` — `useMutation` wrapping `window.import.selectFolder()`. Returns mutation with data type `string | null`.

2. `useCheckAppleNotesAccess()` — `useMutation` wrapping `window.import.checkAppleNotesAccess()`. Returns mutation with data type `{ accessible: boolean; error?: string }`.

3. `useScanImport()` — `useMutation` wrapping `window.import.scan(sourcePath, source)`. Takes `{ sourcePath: string; source: ImportSource }` as mutation variable.

4. `useStartImport()` — The most complex hook. Uses `useMutation` wrapping `window.import.start(options)`. Also:
   - Manages `progress` state via `useState<ImportProgressEvent | null>(null)`.
   - Sets up `useEffect` that calls `window.import.onProgress(callback)` and stores the cleanup function. The callback updates progress state. When `event.status === 'complete'` or `event.status === 'error'`, clear progress after 2s delay.
   - On mutation success: invalidate `['spaces']` query key via `queryClient.invalidateQueries()` (since a new space may have been created).
   - Returns `{ ...mutation, progress }`.

Type imports: Use type-only imports for `ImportSource`, `ImportOptions`, `ImportScanResult`, `ImportResult`, `ImportProgressEvent` from `@preload/types` (these are re-exported there from task D1).

Existing patterns to follow EXACTLY:
- `useModelDownload()` in `src/renderer/src/hooks/useModels.ts` — for the IPC event listener + cleanup pattern in useEffect
- `useCreateSpace()` in `src/renderer/src/hooks/useSpaces.ts` — for mutation + query invalidation pattern

Output expectations:
- All 4 hooks compile with proper TypeScript types.
- `useStartImport` correctly cleans up the IPC listener on unmount.
- Run `pnpm typecheck:web` to verify.
```

---

### Task E2: Extract Format Helpers

**Spec reference:** `docs/ONBOARDING_NEW_USER.md` Section 5.4
**Dependencies:** None
**Files to create:** `src/renderer/src/lib/format.ts`
**Files to modify:** `src/renderer/src/components/ai/ModelCard.tsx`

#### Prompt

```
Extract formatting utility functions into a shared module as specified in `docs/ONBOARDING_NEW_USER.md` Section 5.4.

Architecture rules: Follow `docs/GENERAL_ARCHITECTURE_RULES.md` Section 10 (TypeScript conventions — explicit return types).

File to create: `src/renderer/src/lib/format.ts`

Extract these 3 functions currently defined inline in `src/renderer/src/components/ai/ModelCard.tsx`:

1. `formatSize(bytes: number | undefined): string` — Formats bytes to human-readable (B, KB, MB, GB, TB). Returns 'Unknown size' for null/undefined/NaN.

2. `formatSpeed(bytesPerSecond: number): string` — Formats download speed (B/s, KB/s, MB/s).

3. `formatETA(seconds: number): string` — Formats estimated time remaining (Xs, Xm Xs, Xh Xm).

Read the current implementations from `ModelCard.tsx` and move them exactly as-is to `format.ts` with `export` keyword added.

File to modify: `src/renderer/src/components/ai/ModelCard.tsx`
- Remove the 3 inline function definitions.
- Add import: `import { formatSize, formatSpeed, formatETA } from '@renderer/lib/format'`
- Verify all existing usages of these functions in ModelCard still work.

Existing patterns: Look at `src/renderer/src/lib/utils.ts` for how lib utilities are structured — simple exported functions, no class wrapper.

Output expectations:
- The 3 functions are exported from `format.ts` with explicit return types.
- `ModelCard.tsx` imports from the shared module and behaves identically.
- No other files are changed.
- Run `pnpm typecheck:web` to verify no regressions.
```

---

## Group F — Onboarding UI: Wizard & Simple Steps

### Task F1: OnboardingWizard, WelcomeStep, and Route

**Spec reference:** `docs/ONBOARDING_NEW_USER.md` Sections 3.1, 3.2, 3.3, 3.4
**Dependencies:** A1
**Files to create:** `src/renderer/src/routes/onboarding/index.tsx`, `src/renderer/src/components/onboarding/OnboardingWizard.tsx`, `src/renderer/src/components/onboarding/WelcomeStep.tsx`

#### Prompt

```
Create the onboarding wizard orchestrator, welcome step, and route as specified in `docs/ONBOARDING_NEW_USER.md` Sections 3.1 (Route), 3.2 (Component Hierarchy), 3.3 (State Machine), and 3.4 (UI Layout).

Architecture rules: Follow `docs/GENERAL_ARCHITECTURE_RULES.md` Section 6.1 (component structure: FC with interface, hooks first, handlers with "handle" prefix, early returns, JSX). Section 6.2 (TanStack Router with hash history, file-based routing). Section 11 (TailwindCSS, Shadcn/UI New York style, Lucide icons, cn utility).

Files to create:

1. `src/renderer/src/routes/onboarding/index.tsx` — Route definition:
   - `export const Route = createFileRoute('/onboarding')({ component: OnboardingPage })`
   - `OnboardingPage` renders `<OnboardingWizard />`.
   - Follow the pattern from `src/renderer/src/routes/settings/index.tsx`.

2. `src/renderer/src/components/onboarding/OnboardingWizard.tsx` — The main orchestrator:
   - Define and EXPORT `OnboardingStep` type: `'welcome' | 'import' | 'models' | 'tutorial' | 'complete'`
   - Define and EXPORT `OnboardingState` interface exactly as in spec Section 3.3 (currentStep, import sub-state, models sub-state).
   - Define and EXPORT `OnboardingAction` union type with all action types from spec Section 3.3.
   - Implement `onboardingReducer` handling all actions: NEXT_STEP (advances step in order), GO_TO_STEP, SET_IMPORT_SOURCE, SET_IMPORT_PATH, SET_IMPORT_TARGET, SET_SCAN_RESULT, SET_IMPORT_RESULT, SET_IMPORTING, SKIP_IMPORT, SET_MODEL_STATUS, SKIP_MODELS, COMPLETE.
   - The component uses `useReducer(onboardingReducer, initialState)`.
   - Layout: centered `div` with `flex h-full flex-col items-center justify-center p-8`, inner `div` with `w-full max-w-2xl space-y-8`.
   - Step indicator: horizontal row of steps using Shadcn `Badge` variants (default=active, outline=pending, secondary=completed/skipped). Steps: Welcome, Import, Models, Tutorial, Complete.
   - Renders the active step component based on `state.currentStep`, passing `state` and `dispatch` as props.
   - Navigation footer with "Skip setup" ghost `Button` that calls `handleSkipAll`:
     a. `await window.config.set('onboardingCompleted', true)`
     b. Create "Personal" space if none exist via `window.space.create('Personal', 'Home')`
     c. `navigate({ to: '/' })`
   - Use `useNavigate` from `@tanstack/react-router`.

3. `src/renderer/src/components/onboarding/WelcomeStep.tsx`:
   - Props interface: `{ dispatch: React.Dispatch<OnboardingAction> }`
   - Welcome heading (e.g., "Welcome to TaacNotes") with app description.
   - "Get Started" primary `Button` dispatches `{ type: 'NEXT_STEP' }`.
   - Use a Lucide icon for visual emphasis (e.g., `NotebookPen` or `Sparkles`).

UI components to use: `Button` from `@renderer/components/ui/button`, `Badge` from `@renderer/components/ui/badge`, `cn` from `@renderer/lib/utils`.

Hooks to use: `useNavigate` from `@tanstack/react-router`.

IMPORTANT: Export `OnboardingState`, `OnboardingAction`, and `OnboardingStep` types from OnboardingWizard.tsx — child step components will import them.

Output expectations:
- The wizard manages all step transitions via useReducer.
- Each step receives `state` and `dispatch` as props.
- The route renders at `/#/onboarding` (hash routing).
- Step indicator visually shows progress.
- Placeholder step rendering (e.g., `<div>Import step placeholder</div>`) is fine for steps not yet implemented — they will be replaced in subsequent tasks.
- Run `pnpm typecheck:web` to verify.
```

---

### Task F2: TutorialStep, TutorialCard, and OnboardingComplete

**Spec reference:** `docs/ONBOARDING_NEW_USER.md` Sections 6, 7
**Dependencies:** F1
**Files to create:** `src/renderer/src/components/onboarding/TutorialCard.tsx`, `src/renderer/src/components/onboarding/TutorialStep.tsx`, `src/renderer/src/components/onboarding/OnboardingComplete.tsx`

#### Prompt

```
Create the tutorial and completion step components as specified in `docs/ONBOARDING_NEW_USER.md` Sections 6 (Tutorial Step) and 7 (Onboarding Complete Step).

Architecture rules: Follow `docs/GENERAL_ARCHITECTURE_RULES.md` Section 6.1 (component structure: FC with interface), Section 11 (Shadcn/UI, Lucide, cn utility).

Files to create:

1. `src/renderer/src/components/onboarding/TutorialCard.tsx` (spec Section 6.4):
   - Props interface: `{ icon: LucideIcon; title: string; description: string }`
   - Renders a Shadcn `Card` with `p-6` padding.
   - Icon in a colored circle: `<div className="rounded-lg bg-primary/10 p-2"><Icon className="size-5 text-primary" /></div>`
   - `CardTitle` with `text-base` and `CardDescription` with `text-sm leading-relaxed`.
   - Layout exactly as spec Section 6.4 code snippet.

2. `src/renderer/src/components/onboarding/TutorialStep.tsx` (spec Sections 6.1-6.3):
   - Props: `{ dispatch: React.Dispatch<OnboardingAction> }` — import `OnboardingAction` from `./OnboardingWizard`.
   - Heading "Get to Know TaacNotes".
   - 2x2 grid using `grid grid-cols-2 gap-4`.
   - 4 TutorialCards with content EXACTLY as spec Section 6.2 table:
     | Icon | Title | Content |
     |------|-------|---------|
     | FileText | Writing Notes | Create notes with the rich Markdown editor. Organize them into folders within your spaces. Notes auto-save as you type. |
     | Layout | Spaces | Spaces keep your notes organized by project, topic, or context. You can create up to 5 spaces, each completely isolated. Switch between them from the sidebar. |
     | Bot | AI Assistant | Load an AI model and open the chat panel (Cmd+Shift+A) to ask questions, get summaries, and brainstorm — all powered by a local LLM running on your machine. No data leaves your device. |
     | Search | Smart Search | Your notes are automatically indexed for semantic search. The embedding model understands meaning, not just keywords — so searching "vacation plans" finds notes about "trip to Italy" too. |
   - "Get Started" button dispatches `{ type: 'NEXT_STEP' }`.

3. `src/renderer/src/components/onboarding/OnboardingComplete.tsx` (spec Section 7):
   - Props: `{ state: OnboardingState; dispatch: React.Dispatch<OnboardingAction> }` — import from `./OnboardingWizard`.
   - Heading "You're all set!" with `CheckCircle2` icon.
   - Summary card (Shadcn `Card`) showing:
     - Import result: `state.import.importResult` — show "X notes in Y folders imported" or "Skipped" if `state.import.skipped`.
     - Models: show "Downloaded" or "Skipped" based on `state.models`.
   - "Start Using TaacNotes" primary Button triggers `handleComplete`:
     a. `await window.config.set('onboardingCompleted', true)`
     b. `const spaces = await window.space.list(); if (spaces.length === 0) await window.space.create('Personal', 'Home');`
     c. Set active space: `const activeSpaceId = await window.config.get('activeSpaceId'); if (!activeSpaceId) { const currentSpaces = await window.space.list(); if (currentSpaces.length > 0) await window.config.set('activeSpaceId', currentSpaces[0].id); }`
     d. `navigate({ to: '/' })`
   - Use `useNavigate` from `@tanstack/react-router`.

UI components: `Card`, `CardTitle`, `CardDescription`, `CardContent`, `CardHeader` from `@renderer/components/ui/card`, `Button`, `Badge`, `Separator`.
Lucide icons: `FileText`, `Layout`, `Bot`, `Search`, `CheckCircle2`.

Output expectations:
- TutorialCard is reusable and generic.
- TutorialStep renders a 2x2 grid with the 4 specified cards.
- OnboardingComplete handles ALL completion logic (config set, space creation, active space set, navigation).
- Run `pnpm typecheck:web` to verify.
```

---

## Group G — Onboarding UI: Import Step

### Task G1: ImportSourceSelector and ImportTargetSelector

**Spec reference:** `docs/ONBOARDING_NEW_USER.md` Section 4.8 (sub-steps 1 and 3)
**Dependencies:** E1, F1
**Files to create:** `src/renderer/src/components/onboarding/ImportSourceSelector.tsx`, `src/renderer/src/components/onboarding/ImportTargetSelector.tsx`

#### Prompt

```
Create the import source and target selection UI components as specified in `docs/ONBOARDING_NEW_USER.md` Section 4.8 (sub-steps 1 and 3).

Architecture rules: Follow `docs/GENERAL_ARCHITECTURE_RULES.md` Section 6.1 (component structure: FC with interface, "handle" prefix for event handlers), Section 11 (Shadcn/UI, Lucide).

Files to create:

1. `src/renderer/src/components/onboarding/ImportSourceSelector.tsx` (spec Section 4.8 sub-step 1):
   - Props: `{ dispatch: React.Dispatch<OnboardingAction> }` — import from `./OnboardingWizard`.
   - Two large clickable cards side by side:
     a. "Apple Notes" — Use `Laptop` from Lucide as icon, title "Apple Notes", description "Import from macOS Notes app". ONLY show on macOS: `window.platform === 'darwin'`.
     b. "Obsidian" — Use `FolderOpen` from Lucide, title "Obsidian", description "Import from Obsidian vault".
   - Cards use Shadcn `Card` with hover effect (`hover:border-primary cursor-pointer transition-colors`).
   - Clicking a card dispatches `{ type: 'SET_IMPORT_SOURCE', source: 'apple-notes' | 'obsidian' }`.
   - "Skip import" ghost `Button` at the bottom dispatches `{ type: 'SKIP_IMPORT' }`.

2. `src/renderer/src/components/onboarding/ImportTargetSelector.tsx` (spec Section 4.8 sub-step 3):
   - Props: `{ state: OnboardingState; dispatch: React.Dispatch<OnboardingAction> }`.
   - Two options:
     a. "Create new space" — Shows an `Input` for space name, pre-filled based on source ("Apple Notes" or "Obsidian"). The space name is stored in the wizard state via `dispatch`.
     b. "Add to existing space" — Shows a Shadcn `Select` dropdown populated from `useSpaces()` hook. If no spaces exist, disable this option.
   - Use radio-style selection (highlight the active option card with `border-primary`).
   - Dispatches `{ type: 'SET_IMPORT_TARGET', mode: 'new-space' | 'existing-space', spaceId?: string }` on selection.
   - "Continue" `Button` to proceed to next sub-step.

Existing hooks to use: `useSpaces()` from `@renderer/hooks/useSpaces`.

UI components: `Card`, `Button`, `Input`, `Select` (SelectTrigger, SelectContent, SelectItem, SelectValue), `Label`, `Alert`, `AlertDescription`.
Lucide icons: `Laptop`, `FolderOpen`, `Plus`, `FolderInput`.

Output expectations:
- ImportSourceSelector shows platform-appropriate options (Apple Notes hidden on non-macOS).
- ImportTargetSelector handles both new-space and existing-space modes.
- All state updates go through dispatch.
- Run `pnpm typecheck:web` to verify.
```

---

### Task G2: ImportPreview, ImportProgress, and ImportStep Orchestrator

**Spec reference:** `docs/ONBOARDING_NEW_USER.md` Section 4.8 (sub-steps 2, 4, 5), Section 9.1, 9.2
**Dependencies:** G1, E1
**Files to create:** `src/renderer/src/components/onboarding/ImportPreview.tsx`, `src/renderer/src/components/onboarding/ImportProgress.tsx`, `src/renderer/src/components/onboarding/ImportStep.tsx`

#### Prompt

```
Create the import preview, progress, and top-level import step orchestrator components as specified in `docs/ONBOARDING_NEW_USER.md` Section 4.8 (sub-steps 2, 4, 5) and Sections 9.1-9.2 for error handling.

Architecture rules: Follow `docs/GENERAL_ARCHITECTURE_RULES.md` Section 6.1 (component structure), Section 11 (Shadcn/UI), Section 12 (error handling — toast notifications via sonner).

Files to create:

1. `src/renderer/src/components/onboarding/ImportPreview.tsx` (spec Section 4.8 sub-step 4):
   - Props: `{ state: OnboardingState; dispatch: React.Dispatch<OnboardingAction>; onStartImport: () => void }`
   - Displays scan results from `state.import.scanResult`:
     - Total files count
     - Folder count and names
     - First 10 sample note titles (in a scrollable list)
     - Total size using `formatSize()` from `@renderer/lib/format`
     - Attachment indicator (yes/no badge)
     - Warnings displayed using Shadcn `Alert`
   - Target info: "Creating space 'Obsidian'" or "Importing into 'Personal' > 'Obsidian'"
   - "Start Import" primary `Button` calls `onStartImport`.
   - "Back" ghost `Button` to go back to target selection.

2. `src/renderer/src/components/onboarding/ImportProgress.tsx` (spec Section 4.8 sub-step 5):
   - Props: `{ state: OnboardingState; dispatch: React.Dispatch<OnboardingAction>; progress: ImportProgressEvent | null }`
   - Shadcn `Progress` bar: value = `(progress.current / progress.total) * 100`.
   - Phase text based on `progress.phase`: "Scanning files..." / "Converting notes..." / "Creating notes..." / "Complete!"
   - Current file name display (from `progress.currentFile`).
   - Count display: "{current} / {total} notes".
   - On complete (`progress.status === 'complete'` or `state.import.importResult` is set):
     - Summary card with: imported notes, imported folders, skipped files.
     - If `state.import.importResult.errors.length > 0`: show expandable error list.
   - "Continue" `Button` enabled only on complete, dispatches `{ type: 'NEXT_STEP' }`.

3. `src/renderer/src/components/onboarding/ImportStep.tsx` — Top-level orchestrator:
   - Props: `{ state: OnboardingState; dispatch: React.Dispatch<OnboardingAction> }`
   - Manages sub-steps via local `useState`: `'source' | 'access-check' | 'folder-select' | 'target' | 'preview' | 'progress'`
   - Sub-step flow:
     a. `source` → Render `ImportSourceSelector`. When source is set (state changes), auto-advance:
        - If apple-notes: go to `access-check`
        - If obsidian: go to `folder-select`
     b. `access-check` (Apple Notes only): Auto-run `useCheckAppleNotesAccess()` on mount. If accessible, auto-run `useScanImport()` with the DB path, then go to `target`. If not accessible, show `Alert` with Full Disk Access instructions + "Retry" button + "Select exported folder" fallback button.
     c. `folder-select` (Obsidian, or Apple Notes fallback): Trigger `useSelectImportFolder()` on mount (opens native dialog). If user cancels, go back to `source`. On success, run `useScanImport()`, dispatch `SET_SCAN_RESULT`, then go to `target`.
     d. `target` → Render `ImportTargetSelector`. On continue, go to `preview`.
     e. `preview` → Render `ImportPreview`. On start import:
        - Build `ImportOptions` from `state.import`
        - Call `startImport(options)` from `useStartImport()`
        - Dispatch `{ type: 'SET_IMPORTING', value: true }`
        - Go to `progress`
     f. `progress` → Render `ImportProgress` with `progress` from `useStartImport()`.

Existing hooks to use:
- `useSelectImportFolder()`, `useCheckAppleNotesAccess()`, `useScanImport()`, `useStartImport()` from `@renderer/hooks/useImport`
- `useSpaces()`, `useCreateSpace()`, `useSwitchSpace()` from `@renderer/hooks/useSpaces`

UI components: `Progress`, `Card`, `Button`, `Alert`, `AlertDescription`, `AlertTitle`, `Skeleton` (for loading), `Badge`, `Separator`, `Collapsible` (for error list).
Lucide icons: `AlertCircle`, `CheckCircle2`, `Loader2` (for spinner), `ChevronDown`.

Error handling (spec Section 9.1-9.2):
- Import errors are per-file and non-fatal — show summary after completion.
- Apple Notes permission errors show clear Full Disk Access instructions with retry option.
- Use `toast.error()` from `sonner` for catastrophic errors.

Output expectations:
- ImportStep manages the full sub-step flow for both Apple Notes and Obsidian paths.
- Apple Notes path handles permission check + fallback to exported files.
- Obsidian path handles folder selection + scan.
- Progress is displayed in real-time.
- Run `pnpm typecheck:web` to verify.
```

---

## Group H — Model Download Step

### Task H1: ModelDownloadStep

**Spec reference:** `docs/ONBOARDING_NEW_USER.md` Sections 5.1, 5.2, 5.3
**Dependencies:** E2, F1
**Files to create:** `src/renderer/src/components/onboarding/ModelDownloadStep.tsx`

#### Prompt

```
Create the model download step component as specified in `docs/ONBOARDING_NEW_USER.md` Sections 5.1 (Component), 5.2 (UI Design), and 5.3 (Behavior).

Architecture rules: Follow `docs/GENERAL_ARCHITECTURE_RULES.md` Section 6.1 (component structure: FC with interface), Section 11 (Shadcn/UI).

File to create: `src/renderer/src/components/onboarding/ModelDownloadStep.tsx`

This step reuses existing hooks entirely — NO new main-process code.

Props: `{ state: OnboardingState; dispatch: React.Dispatch<OnboardingAction> }` — import from `./OnboardingWizard`.

Behavior (spec Section 5.3):

1. On mount: query `useDownloadedModels()` to check which models are already downloaded.

2. Display two model cards (custom layout, NOT reusing `ModelCard.tsx` component since the layout is simpler):
   - Qwen3 4B Instruct (ID: `qwen3-4b-instruct-2507-q8`, ~4.3 GB) — "AI Chat Model", powers the AI assistant
   - Nomic Embed v2 (ID: `nomic-embed-text-v2-moe`, ~512 MB) — "Search Model", powers semantic note search
   Each card shows: icon, model name, size, purpose, download status/progress.

3. "Download All" button: triggers both `download('qwen3-4b-instruct-2507-q8')` and `download('nomic-embed-text-v2-moe')` from `useModelDownload()`.

4. Per-model progress: Use Shadcn `Progress` component. Display:
   - Percentage: `Math.round(progress.percentage)%`
   - Speed: `formatSpeed(progress.downloadSpeed)` from `@renderer/lib/format`
   - ETA: `formatETA(progress.eta)` from `@renderer/lib/format`
   - Size: `formatSize(progress.downloadedBytes)` / `formatSize(progress.totalBytes)` from `@renderer/lib/format`

5. Per-model pause/resume: Show pause button during download (`pause(modelId)`), play button when paused (`resume(modelId)`).

6. Already downloaded: Show `Badge` with "Downloaded" and `CheckCircle2` icon.

7. When both complete: dispatch `{ type: 'SET_MODEL_STATUS', chat: true, embedding: true }` and enable "Continue" button (dispatches `{ type: 'NEXT_STEP' }`).

8. "Skip for now" ghost button dispatches `{ type: 'SKIP_MODELS' }`.

9. Show hardware info from `useHardwareInfo()`: tier name and RAM.

10. Handle error state: show `Alert` with error message and "Retry" button.

Existing hooks to use:
- `useDownloadedModels()` from `@renderer/hooks/useModels` — query key `['ai', 'models', 'downloaded']`
- `useModelDownload()` from `@renderer/hooks/useModels` — provides `download`, `pause`, `resume`, `progress` Map<string, DownloadProgress>
- `useHardwareInfo()` from `@renderer/hooks/useHardware`

Shared utilities: `formatSize`, `formatSpeed`, `formatETA` from `@renderer/lib/format`.

Model IDs are constants — verify they match `src/main/ai/ModelRegistry.ts` CURATED_MODELS array.

UI components: `Card`, `Progress`, `Button`, `Badge`, `Alert`, `AlertDescription`, `Separator`, `Skeleton`.
Lucide icons: `Bot`, `Search`, `Download`, `Pause`, `Play`, `CheckCircle2`, `AlertCircle`, `Loader2`.

Output expectations:
- Both models displayed with download progress.
- Already-downloaded models show checkmark status.
- Progress shows speed, ETA, and percentage.
- Hardware info displayed.
- Run `pnpm typecheck:web` to verify.
```

---

## Group I — Integration

### Task I1: Root Layout Conditional Rendering and Route Redirect

**Spec reference:** `docs/ONBOARDING_NEW_USER.md` Sections 2.3, 2.4, 8.1
**Dependencies:** F1, F2
**Files to modify:** `src/renderer/src/routes/__root.tsx`, `src/renderer/src/routes/index.tsx`

#### Prompt

```
Wire the onboarding into the app shell as specified in `docs/ONBOARDING_NEW_USER.md` Sections 2.3 (Conditional Root Layout), 2.4 (Route Redirect), and 8.1 (Skip Behavior).

Architecture rules: Follow `docs/GENERAL_ARCHITECTURE_RULES.md` Section 6.1 (component structure), Section 6.2 (TanStack Router).

Files to modify:

1. `src/renderer/src/routes/__root.tsx` (spec Section 2.3):
   - Add `useConfig('onboardingCompleted')` at the top of the `RootLayout` component. Import `useConfig` from `@renderer/hooks/useConfig`.
   - Before the existing full layout return, add a conditional check:
     ```tsx
     const { data: onboardingDone, isLoading } = useConfig('onboardingCompleted')

     // Show minimal layout during onboarding or while loading config
     if (isLoading || !onboardingDone) {
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
     ```
   - The minimal layout has NO sidebar, NO header, NO AI panel — just the window drag border and `Outlet`.
   - Keep ALL existing imports and the full layout code intact for the normal (post-onboarding) case.
   - IMPORTANT: Handle the loading state — while `useConfig` query is pending, show the minimal layout to prevent a flash of the full sidebar before redirecting to onboarding.

2. `src/renderer/src/routes/index.tsx` (spec Section 2.4):
   - Add a `beforeLoad` guard that redirects to `/onboarding` when onboarding is not completed:
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
   - Import `redirect` from `@tanstack/react-router`.
   - Keep or update the existing `HomeView` / `RouteComponent` (the current placeholder `<div>Hello</div>` is fine).

Existing patterns:
- Look at `src/renderer/src/routes/settings/ai.tsx` for how routes use `createFileRoute`.
- Look at the current `__root.tsx` for the `WINDOW_BORDER_WIDTH` and `WINDOW_TRAFFIC_LIGHTS_HEIGHT` constants and how `isMacOS` is determined.

Important considerations:
- The `useConfig` hook returns `{ data, isLoading }`. During initial load, `data` is undefined. The layout must NOT flash the full sidebar during this period — showing the minimal layout while loading is the correct behavior.
- The `beforeLoad` function runs before the component renders and has access to `window.config` (preload API) — it does NOT use React hooks.
- After onboarding completion, when `onboardingCompleted` is set to `true` via `window.config.set()`, the `useConfig` hook will reactively update (it has an `onChange` listener), causing the root layout to re-render with the full layout.

Output expectations:
- New users see only the minimal layout (no sidebar/header) and are redirected to `/onboarding`.
- Existing users (onboardingCompleted: true) see the full layout as before.
- No layout flash during initial config load.
- Run `pnpm typecheck:web` to verify.
```

---

## Verification Checklist

After all tasks are complete:

1. `pnpm typecheck` — Full TypeScript check (node + web) passes
2. `pnpm lint` — ESLint passes
3. First-run flow: App launches → redirects to `/onboarding` → wizard renders in minimal layout
4. Skip flow: "Skip setup" on welcome → creates Personal space → navigates to `/` with full layout
5. Import flow (Obsidian): Select source → pick folder → scan preview → select target → import with progress
6. Import flow (Apple Notes): Select source → permission check → auto-scan or fallback → target → import
7. Model download flow: Shows both models → download with progress → pause/resume → continue on completion
8. Tutorial flow: 4 cards displayed in grid → "Get Started" advances
9. Complete flow: Summary shown → "Start Using TaacNotes" → config set → navigate to `/`
10. Quit-and-resume: Quit during onboarding → relaunch → starts from welcome step
11. Post-onboarding: Full layout with sidebar/header/AI panel renders correctly
