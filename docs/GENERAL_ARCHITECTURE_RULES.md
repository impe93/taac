# Taac — General Architecture & Coding Rules

## 1. Project Overview

Taac is an AI-native note-taking desktop application.

| Layer   | Technology                                                              |
| ------- | ----------------------------------------------------------------------- |
| Shell   | Electron 35                                                             |
| UI      | React 19, TanStack Router, TanStack Query                               |
| State   | Redux Toolkit (notes tree), TanStack Query (server state)               |
| Editor  | MDXEditor                                                               |
| Styling | TailwindCSS v4, Shadcn/UI (New York style), Lucide icons                |
| AI      | node-llama-cpp (local LLMs), sqlite-vec (vector search), better-sqlite3 |
| Build   | electron-vite, pnpm                                                     |

---

## 2. Electron 3-Process Model

```
┌─────────────────────────────────────────────────┐
│                  Main Process                    │
│  src/main/                                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ Managers  │ │ IPC      │ │ AI Subsystem     │ │
│  │ FSManager │ │ Handlers │ │ AIManager        │ │
│  │ SpaceMgr  │ │          │ │ EmbeddingService │ │
│  │ configStore│ │         │ │ VectorDBManager  │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
└────────────────────┬────────────────────────────┘
                     │ IPC (invoke / send)
┌────────────────────┴────────────────────────────┐
│               Preload Scripts                    │
│  src/preload/                                    │
│  contextBridge.exposeInMainWorld(...)             │
│  window.fileSystem / window.ai / window.config   │
│  window.space / window.platform                  │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────┴────────────────────────────┐
│              Renderer Process                    │
│  src/renderer/                                   │
│  React 19 + Redux Toolkit + TanStack             │
└─────────────────────────────────────────────────┘
```

**Hard rule:** All communication between renderer and main goes through the preload layer. The renderer never accesses Node.js APIs directly.

---

## 3. Main Process Patterns

### 3.1 Singleton Pattern

Core managers are singletons with private constructors and `getInstance()`:

```typescript
class AIManager {
  private static instance: AIManager | null = null
  private constructor() {}

  static getInstance(): AIManager {
    if (!AIManager.instance) AIManager.instance = new AIManager()
    return AIManager.instance
  }
}
```

Used by: `AIManager`, `ConversationManager`, `SpaceManager`.

### 3.2 Factory / Map-Based Cache

Per-space resources use a factory function that caches instances:

```typescript
const fsManagerMap = new Map<string, FileSystemManager>()

export function getOrCreateFsManager(spaceId: string): FileSystemManager {
  if (!fsManagerMap.has(spaceId)) {
    const manager = new FileSystemManager(spaceId)
    fsManagerMap.set(spaceId, manager)
    manager.initialize().catch(console.error)
  }
  return fsManagerMap.get(spaceId)!
}
```

Used by: `FileSystemManager`, `VectorDBManager`.

### 3.3 Idempotent Initialization

All managers implement a guard-based `initialize()`:

```typescript
async initialize(): Promise<void> {
  if (this.initialized) return
  // ... setup logic
  this.initialized = true
}
```

### 3.4 Explicit Disposal

Long-lived resources expose a `dispose()` method that clears intervals, empties maps, removes event listeners, and resets state flags:

```typescript
async dispose(): Promise<void> {
  if (this.cleanupInterval) clearInterval(this.cleanupInterval)
  for (const id of this.loadedModels.keys()) await this.unloadModel(id)
  this.initialized = false
}
```

### 3.5 Native Module Handling (ESM)

`node-llama-cpp` is ESM-only. The pattern is:

1. **Type-only imports** at the top level (erased at compile time):
   ```typescript
   import type { Llama, LlamaModel } from 'node-llama-cpp'
   ```
2. **Dynamic `import()`** at runtime inside `initialize()`:
   ```typescript
   this.nodeLlamaCpp = await import('node-llama-cpp')
   ```

This applies to any ESM-only dependency used in the main process.

### 3.6 Path Validation

File system operations validate paths to prevent directory traversal:

```typescript
private validatePath(requestedPath: string, allowedBase: string): string {
  const resolved = resolve(allowedBase, normalize(requestedPath))
  if (!resolved.startsWith(allowedBase))
    throw new Error('Invalid path: directory traversal detected')
  return resolved
}
```

### 3.7 Logging Convention

All main-process logs use a `[ClassName]` prefix:

```
[AIManager] Initialized at ...
[VectorDBManager] sqlite-vec version: ...
[IndexingQueue] Auto-indexing enabled
```

---

## 4. Preload Layer

The preload script (`src/preload/index.ts`) exposes five namespaced APIs via `contextBridge.exposeInMainWorld`:

| Namespace           | Purpose                                                        |
| ------------------- | -------------------------------------------------------------- |
| `window.fileSystem` | Note/folder/asset CRUD, move operations, database path         |
| `window.space`      | Space list/create/update/delete (max 5)                        |
| `window.config`     | Typed electron-store get/set + `onChange` listener             |
| `window.ai`         | Model management, streaming chat, vector search, conversations |
| `window.platform`   | `process.platform` for OS-specific UI                          |

**Patterns:**

- All operations use `ipcRenderer.invoke()` (request-response).
- Real-time events (streaming, progress) use `ipcRenderer.on()` with a cleanup function returned to the caller.
- Types are declared in `src/preload/types.ts` (entities) and `src/preload/index.d.ts` (API surface).

---

## 5. IPC Communication Patterns

### 5.1 Request-Response (Handler Registration)

```typescript
export function registerXHandlers(deps: Dependencies): void {
  ipcMain.handle('namespace:operation', async (_event, ...args) => {
    try {
      return await manager.operation(...args)
    } catch (error) {
      throw new Error(`Failed to operation: ${(error as Error).message}`)
    }
  })
}
```

Rules:

- Namespace with colon: `fs:createNote`, `ai:generateResponse`, `config:get`.
- Always wrap in try/catch and re-throw with a contextual message.
- Lazy-access singletons via getter functions inside the handler module.

### 5.2 Streaming / Progress Events

Main → Renderer push via `webContents.send()`:

```typescript
event.sender.send('ai:response-chunk', { chunk, fullResponse })
```

Broadcast to all windows for global events:

```typescript
BrowserWindow.getAllWindows().forEach((win) => {
  if (!win.webContents.isDestroyed()) win.webContents.send('ai:indexing-progress', data)
})
```

### 5.3 Cross-Handler Callbacks

File handlers notify AI handlers on note save for auto-indexing via a callback injected at registration time:

```typescript
// main/index.ts
registerFileHandlers(getOrCreateFsManager, notifyNoteSaved)
```

This keeps handlers decoupled — file handlers don't import AI logic.

---

## 6. Renderer Patterns

### 6.1 Component Structure

```typescript
import { type FC } from 'react'

interface ComponentProps {
  id: string
  className?: string
}

export const Component: FC<ComponentProps> = ({ id, className }) => {
  // 1. Hooks (queries, mutations, Redux selectors, local state)
  // 2. Effects
  // 3. Event handlers (prefixed with "handle")
  // 4. Early returns (loading, error, empty)
  // 5. JSX
}
```

Rules:

- Always use `FC<Props>` with an explicit `interface` for props.
- Event handlers are prefixed with `handle`: `handleClick`, `handleKeyDown`, `handleSubmit`.
- Use `type` keyword for type-only imports: `import { type FC } from 'react'`.

### 6.2 Routing (TanStack Router)

- **Hash history** (mandatory for Electron's `file://` protocol).
- File-based routing with auto code-splitting.
- Route params accessed via `Route.useParams()`.
- Routes in `src/renderer/src/routes/`.

### 6.3 Provider Hierarchy

```
ReduxProvider
  └─ ReduxInitializer (cache hydration → filesystem reconciliation)
       └─ QueryClientProvider
            └─ ThemeProvider (next-themes)
                 └─ SidebarProvider (Shadcn)
                      └─ {children} + <Toaster />
```

### 6.4 Custom Hooks

All hooks are in `src/renderer/src/hooks/` and follow consistent patterns:

| Category  | Examples                                     | Pattern                            |
| --------- | -------------------------------------------- | ---------------------------------- |
| State     | `useAppDispatch`, `useAppSelector`           | Typed Redux wrappers               |
| Data      | `useSpaces`, `useConfig`, `useConversations` | TanStack Query with query keys     |
| Mutations | `useCreateNote`, `useSwitchSpace`            | `useMutation` + cache invalidation |
| AI        | `useAIChat`, `useIndexAllNotes`              | Streaming/progress via IPC events  |
| Behavior  | `useAutoSave`, `useAutoIndexNote`            | Debounced side effects             |
| UI        | `useAIChatPanel`                             | Keyboard shortcuts + local state   |

**Query keys** follow a hierarchical convention:

```typescript
const conversationKeys = {
  all: ['ai', 'conversations'],
  detail: (id: string) => ['ai', 'conversation', id]
}
```

---

## 7. State Management Strategy

### When to use Redux Toolkit

- **Notes tree** (folders, notes) — highly interconnected, normalized state.
- **UI state** per space (expanded folders, selection).
- **Optimistic updates** with automatic rollback on error.
- **Persistence** to `electron-store` via custom middleware.

### When to use TanStack Query

- **Spaces list** — simple CRUD, cache invalidation.
- **Config values** — with `onChange` IPC listener for real-time sync.
- **AI models, conversations, hardware info** — server-state semantics.
- **One-off fetches** that don't require normalization.

### Why the split

The notes tree is deeply nested and cross-referenced — Redux normalized state with `Record<string, Entity>` enables O(1) lookups and clean optimistic updates. TanStack Query handles everything that behaves like "remote data" (even if the remote is just the main process).

---

## 8. Multi-Space Architecture

### Data Isolation

Each space is fully isolated:

```
{userData}/spaces/
├── spaces.json              # Global metadata
└── {spaceId}/
    ├── notes/{folderId}/    # Notes as JSON files
    ├── assets/              # images/, pdfs/, attachments/
    └── database/vectors.db  # Per-space vector DB
```

### Redux Shape

```typescript
spaces: Record<string, SpaceTreeState>  // All spaces in memory
activeSpaceId: string | null

SpaceTreeState {
  folders: Record<string, FolderMetadata>   // Normalized
  notes: Record<string, Note>               // Normalized
  expandedFolders: string[]                 // UI
  selectedNoteId: string | null
  isCacheHydrated: boolean
  isFullyHydrated: boolean
}
```

### Hydration Strategy (Two-Stage)

1. **Cache hydration** — Restore all spaces from `electron-store` (`reduxSpacesCaches` key). Instant, no I/O.
2. **Filesystem reconciliation** — Load the _active_ space from disk via `loadTree` thunk, validate against cache, clean stale entries.

Legacy single-space caches are automatically migrated on first load.

### Persistence Middleware

Two trigger types:

| Trigger        | Actions                                           | Debounce  |
| -------------- | ------------------------------------------------- | --------- |
| UI state       | `toggleFolder`, `selectNote`, ...                 | Immediate |
| Tree mutations | `createNote/fulfilled`, `loadTree/fulfilled`, ... | 1 second  |

Persisted structure per space:

```typescript
{ tree: { folders, notes }, ui: { expandedFolders, selectedNoteId }, metadata: { lastSaved, version } }
```

### Optimistic Updates

Move operations (note/folder) apply changes immediately in the reducer (`pending`), confirm with backend data (`fulfilled`), or rollback to the snapshot captured at `pending` (`rejected`).

---

## 9. AI & RAG Subsystem

### Component Responsibilities

| Component             | Role                                                                     |
| --------------------- | ------------------------------------------------------------------------ |
| `AIManager`           | Singleton. LLM init, model load/unload, GPU optimization, streaming chat |
| `ModelRegistry`       | Static `CURATED_MODELS` array with model definitions                     |
| `EmbeddingService`    | Token-based chunking (256 tok/chunk, 32 overlap), note indexing          |
| `VectorDBManager`     | Per-space sqlite-vec (768-dim, cosine distance), hybrid search           |
| `IndexingQueue`       | Debounced (3s) background queue with EventEmitter progress               |
| `ModelDownloader`     | Resumable downloads with progress events                                 |
| `ConversationManager` | Chat history persistence                                                 |
| `HardwareDetector`    | CPU/RAM/GPU/VRAM detection                                               |

### Embedding Model Rules

The embedding model (`nomic-embed-text-v2-moe`) **requires task prefixes**:

| Method                | Prefix              | Use            |
| --------------------- | ------------------- | -------------- |
| `embedDocument(text)` | `search_document: ` | Indexing notes |
| `embedQuery(text)`    | `search_query: `    | Searching      |
| `embedText(text)`     | _(none)_            | Raw embedding  |

### Hybrid Search Pipeline

1. **Vector KNN** — Top-20, cosine distance pre-filter `<= 0.75` (min similarity 0.25)
2. **BM25 keyword search** — Top-20 via FTS5
3. **RRF fusion** — Vector weight 1.0, BM25 weight 0.7, k=60. Vector contribution is distance-weighted: `vectorWeight * cosineSim / (rrfK + rank)`
4. **Heuristic boosts** — Same-note, title match, recency
5. **Dynamic threshold** — 40% of best RRF score
6. **Context expansion** — Section/window expansion within token budget

### Streaming Chat

Uses an `AsyncGenerator` with a real-time chunk queue:

```typescript
async *generateChatCompletion(modelId, messages, options): AsyncGenerator<string, ChatCompletionResult> {
  // onTextChunk callback pushes to queue
  // Generator yields chunks as they arrive
  // Returns final result with token count
}
```

Renderer receives chunks via `ai:response-chunk` IPC event.

### Memory Management

- Max 2 loaded models simultaneously (LRU eviction).
- Models idle for 5+ minutes are automatically unloaded.
- GPU layers calculated at 80% of available VRAM.

---

## 10. TypeScript Conventions

### Type Imports

Always use `type` keyword for type-only imports:

```typescript
import { type FC, type ReactNode } from 'react'
import type { Note, FolderMetadata } from '@preload/types'
```

### Interfaces vs Types

- **Interfaces** for component props and object shapes.
- **Types** for unions, utilities, mapped types.

### Path Aliases

| Alias         | Resolves To                                   |
| ------------- | --------------------------------------------- |
| `@renderer/*` | `src/renderer/src/*`                          |
| `@preload/*`  | `src/preload/*`                               |
| `@main/ai/*`  | `src/main/ai/*` (renderer access to AI types) |

### Avoid `any`

Use unknown + type narrowing or explicit types. The `_` prefix exempts unused function parameters from lint errors.

---

## 11. Styling & UI

### TailwindCSS v4

- Configured inline in `src/renderer/src/assets/global.css` with `@import 'tailwindcss'`.
- No `tailwind.config.js` — v4 uses CSS-native configuration.
- OkLCh color space for theme tokens.
- Light/dark mode via `.dark` class (next-themes).

### Shadcn/UI

- **Style:** New York.
- **Base color:** Neutral.
- **Icon library:** Lucide React.
- Components live in `src/renderer/src/components/ui/`.
- Add new components: `pnpm ui-add`.

### `cn` Utility

Always use for conditional/merged class names:

```typescript
import { cn } from '@renderer/lib/utils'

<div className={cn('base-class', isActive && 'active-class', className)} />
```

### Icons

Exclusively Lucide React:

```typescript
import { Folder, FileText, Settings } from 'lucide-react'
```

---

## 12. Error Handling

### Main Process — Custom Error Hierarchy

```typescript
class AIError extends Error {
  constructor(message: string, public readonly code: string, public readonly recoverable = true) {
    super(message)
  }
}

class AINotInitializedError extends AIError { ... }
```

### Renderer — Toast Notifications

```typescript
import { toast } from 'sonner'

toast.success('Note created')
toast.error('Failed to save')
```

### Async Thunk Error Pattern

```typescript
dispatch(createNote(args))
  .unwrap()
  .then(() => toast.success('Created'))
  .catch((error) => toast.error(error.message))
```

### Graceful Degradation

Non-critical operations (cleanup, BM25 fallback) catch errors silently and return empty/default values:

```typescript
async bm25Search(query: string): Promise<BM25SearchResult[]> {
  try {
    return this.db.prepare(`...`).all(sanitized, limit)
  } catch {
    console.warn('[VectorDBManager] BM25 search failed')
    return []
  }
}
```

---

## 13. Performance Patterns

### Debouncing

| Operation         | Delay | Implementation                           |
| ----------------- | ----- | ---------------------------------------- |
| Auto-save         | 1.5s  | `useAutoSave` hook                       |
| Auto-indexing     | 5s    | `useAutoIndexNote` hook                  |
| Redux persistence | 1s    | `persistenceMiddleware`                  |
| Indexing queue    | 3s    | `IndexingQueue` (deduplicates by noteId) |

### Query Caching

| Data                    | staleTime        |
| ----------------------- | ---------------- |
| Config, spaces, DB path | `Infinity`       |
| Embedding model status  | 30s              |
| Notes                   | 5 min            |
| Loaded models           | Polling every 5s |

### Memoization

- Redux selectors are memoized (reselect).
- `useCallback` for event handlers passed as props.
- `useMemo` for expensive computations.

---

## 14. Drag-and-Drop

Library: `@dnd-kit/core`.

- **Activation:** 10px mouse distance threshold, 250ms touch delay.
- **Collision:** `closestCorners`.
- **Drag items:** `{ type: 'note' | 'folder', id, name, folderId }`.
- **Drop targets:** `{ type: 'folder' | 'space', folderId?, spaceId? }`.
- **Auto-expand:** Folders expand after 1.5s hover during drag.
- **Circular dependency validation:** Prevents moving a folder into its own descendant.
- **Global drag overlay:** Portal-rendered with icon + name.
- **Optimistic updates:** Immediate Redux update, rollback on IPC failure.

---

## 15. Build & Tooling

### Package Manager

**pnpm** with `shamefully-hoist=true`.

### Build System (electron-vite)

Three separate configurations for main, preload, and renderer:

- **Main:** Externalizes native modules (`node-llama-cpp`, `better-sqlite3`, `sqlite-vec`) via both `externalizeDepsPlugin` and `rollupOptions.external`. Excludes `electron-store` from externalization (ESM fix).
- **Renderer:** React plugin, TanStack Router plugin (auto code-splitting), TailwindCSS v4 plugin. Path aliases: `@renderer/*`, `@preload/*`.

### TypeScript

Three tsconfig files:

| File                 | Scope                     |
| -------------------- | ------------------------- |
| `tsconfig.node.json` | Main process + preload    |
| `tsconfig.web.json`  | Renderer (JSX: react-jsx) |
| `tsconfig.app.json`  | Application-specific      |

### Code Quality

| Tool         | Config                                                                             |
| ------------ | ---------------------------------------------------------------------------------- |
| ESLint 9     | Flat config (`eslint.config.mjs`), `@typescript-eslint`, React hooks/refresh rules |
| Prettier     | Single quotes, no semicolons, 100 char width, no trailing commas                   |
| EditorConfig | UTF-8, 2-space indent, LF line endings                                             |

### Electron Builder

- ASAR unpacking for native modules (`sqlite-vec`, `better-sqlite3`).
- macOS entitlements for JIT compilation and unsigned executable memory (required by `node-llama-cpp`).
- Custom `taac-asset://` protocol for serving local assets.

### macOS Code Signing & Notarization

Distribution builds (`pnpm build:mac`) are signed with a **Developer ID Application**
certificate and **notarized** by Apple, so Gatekeeper opens the app without the
"unidentified developer / unable to verify for malware" warning on first launch.

- **Hardened Runtime** is enabled (`mac.hardenedRuntime: true`) — mandatory for
  notarization. `build/entitlements.mac.plist` (app) and
  `build/entitlements.mac.inherit.plist` (child processes) relax it just enough:
  `allow-jit` + `allow-unsigned-executable-memory` for `node-llama-cpp`, and
  `disable-library-validation` so the embedded Python/MLX interpreter can load its
  bundled (non-Apple-signed) dylibs. The inherit plist is what lets the Python
  sidecar and native worker processes run under Hardened Runtime.
- **Nested Python runtime signing** (`scripts/afterPack.mjs`): the CPython + MLX
  runtime shipped via `mac.extraResources` is NOT reliably signed by
  electron-builder's own pass, and notarization rejects any unsigned Mach-O. This
  `afterPack` hook deep-signs every real Mach-O under
  `Contents/Resources/python-runtime` before the bundle is signed.
- **Credentials** are read from the environment (`APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`); `mac.notarize: true` triggers
  notarization and stapling automatically. See `.env.example`. electron-builder
  does not auto-load `.env`, so export first:
  `set -a && source .env && set +a && pnpm build:mac`.
- **Verify** a build: `spctl -a -vvv -t install dist/mac-arm64/Taac.app` (expect
  "accepted, source=Notarized Developer ID") and
  `xcrun stapler validate dist/Taac-<ver>.dmg`.
- **MLX metallib deployment target** (`scripts/prepare-asr-runtime.sh`): `mlx` and
  `mlx-metal` publish per-SDK wheels (`macosx_14_0`, `macosx_15_0`, `macosx_26_0`).
  pip picks the wheel matching the BUILD host, so building on a newer macOS bundles
  a `mlx.metallib` compiled for that OS's Metal Shading Language — which then fails
  to load on older macOS (`SIGABRT: Failed to load the default metallib … language
  version N.0 … not supported on this OS`). The script pins the `macosx_14_0` wheels
  (MLX's minimum OS) so the runtime works on every supported macOS regardless of the
  build host, with a build-time guardrail asserting the bundled wheel tags.

### Release & Auto-update

Distribution is macOS **arm64 only** (the bundled Python/MLX runtime is arm64;
`scripts/prepare-asr-runtime.sh` no-ops elsewhere) and flows entirely from a git
tag:

`pnpm release:<patch|minor|major>` (`scripts/release.mjs`) → typecheck + lint →
`npm version` (commit + tag `vX.Y.Z`) → `git push --follow-tags` →
`.github/workflows/release.yml` → build, sign, notarize, `electron-builder --mac
--publish always` → GitHub Release with `.dmg`, `.zip` and `latest-mac.yml`.

- **Two mac targets are mandatory**: the `.dmg` is the human download, the `.zip`
  is what Squirrel.Mac installs. Without a `zip` target electron-builder cannot
  emit `latest-mac.yml` and the updater is dead. The zip must keep the DEFAULT
  `artifactName` — `latest-mac.yml` points at that exact filename.
- **`publish` = GitHub Releases** (`electron-builder.yml` + `dev-app-update.yml`
  must stay in sync). No token is embedded in the app: this only works while the
  repository is public.
- **CI keychain gotcha**: `scripts/afterPack.mjs` and
  `scripts/afterAllArtifactBuild.mjs` resolve the identity with `security
  find-identity`, which only sees keychains in the user search list. The workflow
  therefore imports the `.p12` into its own keychain, adds it to the search list
  and exports `CSC_KEYCHAIN` (both hooks pass it to `find-identity`/`codesign`);
  `CSC_LINK` is deliberately unused, because the temporary keychain it creates
  would be invisible to those hooks and the nested Python runtime would ship
  unsigned → notarization failure.
- **Required repository secrets**: `MACOS_CERTIFICATE` (the Developer ID
  Application `.p12`, base64), `MACOS_CERTIFICATE_PWD`, `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. The keychain password is
  generated inside the job — it protects a keychain that is deleted with it. A
  missing secret used to surface as an opaque `SecKeychainItemImport … not valid`
  (empty base64 → 0-byte `.p12`), so the workflow now preflights them and asserts
  that a `Developer ID Application` identity actually landed in the keychain.
- **Exporting the `.p12`**: Keychain Access only offers the `.p12` format when the
  certificate and its private key live in the **same** keychain, under *My
  Certificates*. `security find-identity` without a keychain argument joins them
  across the whole search list, so an identity can look healthy while the two
  halves sit in different keychains (ours: cert in `System.keychain`, key in
  `login.keychain-db`) and the export silently offers only `.cer/.pem/.p7b`. Fix
  by importing the certificate into the keychain holding the key:
  `security find-certificate -c "Developer ID Application: …" -p
  /Library/Keychains/System.keychain > /tmp/devid.pem && security import
  /tmp/devid.pem -k ~/Library/Keychains/login.keychain-db`. Current cert expires
  **Jul 2031**.
- **Updater vs. shutdown ordering**: `src/main/utils/updater.ts` never calls
  `quitAndInstall()` from an IPC handler — that would race the `before-quit`
  cleanup that disposes the llama/Python sidecars. `requestInstall()` arms a flag
  and quits; `finalizeQuit()`, called at the end of the existing shutdown chain in
  `src/main/index.ts`, performs the install.
- **Dev behaviour**: checks are disabled unless `TAAC_FORCE_UPDATE_CHECK=1`
  (an unsigned dev build cannot install anything anyway).

---

## 16. File System Layout

```
{userData}/
└── spaces/
    ├── spaces.json
    └── {spaceId}/
        ├── notes/
        │   ├── root/
        │   │   └── metadata.json
        │   └── {folderId}/
        │       ├── {noteId}.json
        │       └── metadata.json
        ├── assets/
        │   ├── images/
        │   ├── pdfs/
        │   └── attachments/
        └── database/
            └── vectors.db
```

---

## 17. Essential Commands

```bash
pnpm dev              # Development with hot reload
pnpm typecheck        # All TypeScript checks (node + web)
pnpm typecheck:node   # Main process only
pnpm typecheck:web    # Renderer only
pnpm lint             # ESLint with cache
pnpm format           # Prettier
pnpm build            # Full production build (includes typecheck)
pnpm build:mac        # macOS build
pnpm build:win        # Windows build
pnpm build:linux      # Linux build
pnpm release:patch    # Bump + tag + push → triggers the release workflow
pnpm publish:mac      # Manual build + notarize + publish to GitHub Releases
pnpm ui-add           # Add Shadcn/UI components
```
