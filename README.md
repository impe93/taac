# Taac

An AI-native note-taking desktop application built with Electron, React 19, Lexical editor, and the TanStack ecosystem. Taac provides a modern, performant environment for creating and organizing notes with AI-powered features.

## Tech Stack

- **Electron 35** - Cross-platform desktop framework
- **React 19** - UI library with TypeScript
- **Lexical** - Extensible rich text editor framework
- **TanStack Router** - Type-safe file-based routing
- **TanStack Query** - Data fetching and caching
- **Shadcn/UI + Radix** - Accessible UI component library
- **TailwindCSS v4** - Utility-first styling
- **electron-store** - Persistent configuration storage

## Spaces

Taac organizes notes into **Spaces** (max 5), each with its own isolated directory tree, custom name, and Lucide React icon. Spaces are managed by `SpaceManager` (`src/main/utils/spaceManager.ts`) which handles CRUD operations and stores metadata in `spaces/spaces.json`. Each space has a dedicated `FileSystemManager` instance that operates on `{userData}/spaces/{spaceId}/` for complete data isolation. The active space is tracked in `electron-store` and accessed via `useActiveSpace()` hook (`src/renderer/src/hooks/useSpaces.ts`), with UI components in `src/renderer/src/components/spaces/` for switching and managing spaces.

## Notes Tree & Drag-and-Drop

Taac features a hierarchical **Notes Tree** (`src/renderer/src/components/notes-tree/`) that provides intuitive navigation and organization of notes and folders within each space. The tree is built with **@dnd-kit/core** to enable smooth drag-and-drop functionality for reorganizing content. Notes and folders can be dragged onto other folders or dropped in empty space to move to root level, with visual feedback including ghost overlays and drop zone highlighting. To prevent accidental activation, drag requires 10px mouse movement before activating, allowing normal clicks for expanding/collapsing folders and selecting notes. The tree implements auto-expand behavior (folders open after 1.5s hover during drag), optimistic Redux state updates with automatic rollback on errors, and validates against circular dependencies to prevent moving folders into their own descendants. Move operations are handled by `FileSystemManager.moveNote()` and `FileSystemManager.moveFolder()` methods with atomic file operations and metadata updates, all persisted to `electron-store` cache via the persistence middleware for instant hydration on app restart.

## File System Utilities

Taac includes a comprehensive file system management layer for handling notes, folders, assets, and configuration with full type safety and IPC communication between Electron processes.

### Architecture

**Main Process** (`src/main/utils/fileSystem.ts`):

- `FileSystemManager` class handles all file operations
- Stores data in platform-specific `userData` directory
- Provides CRUD operations for notes, folders, and assets
- Implements path validation to prevent directory traversal attacks
- UUID-based file naming for security

**IPC Handlers** (`src/main/ipc/`):

- `fileHandlers.ts` - Exposes file operations to renderer via IPC
- `configHandlers.ts` - Exposes configuration operations
- All operations use async `ipcMain.handle()` for request/response pattern

**Preload Bridge** (`src/preload/index.ts`):

- Exposes `window.fileSystem` and `window.config` APIs via `contextBridge`
- Maintains context isolation for security
- Full TypeScript type definitions in `src/preload/index.d.ts`

**React Hooks** (`src/renderer/src/hooks/`):

- `useFileSystem.ts` - TanStack Query hooks for notes, folders, and assets
- `useConfig.ts` - Configuration management hooks
- Automatic cache invalidation and optimistic updates

### Directory Structure

```
{userData}/
├── notes/              # User notes organized in folders
│   ├── root/
│   │   └── metadata.json
│   └── {folder-id}/
│       ├── {note-id}.json
│       └── metadata.json
├── assets/             # File attachments
│   ├── images/
│   ├── pdfs/
│   └── attachments/
├── database/           # SQLite vector database
│   └── vectors.db
├── config/             # Application configuration
│   └── config.json
└── logs/               # Application logs
```

### Usage Examples

**Creating a Note:**

```typescript
import { useCreateNote } from '@renderer/hooks/useFileSystem'

const { mutate: createNote } = useCreateNote()

createNote({
  folderId: 'root',
  content: lexicalEditorState,
  title: 'My Note'
})
```

**Listing Notes:**

```typescript
import { useNotes } from '@renderer/hooks/useFileSystem'

const { data: notes, isLoading } = useNotes(folderId)
```

**Managing Config:**

```typescript
import { useConfig, useSetConfig } from '@renderer/hooks/useConfig'

const { data: theme } = useConfig('theme')
const { mutate: setTheme } = useSetConfig()

setTheme({ key: 'theme', value: 'dark' })
```

### Type Safety

All file operations are fully typed with TypeScript interfaces:

- `Note` - Lexical editor state with metadata
- `FolderMetadata` - Folder tree structure
- `Asset` - File attachment metadata
- `AppConfig` - Application configuration schema

Types are shared across processes via `@preload/types` import alias.

## Development

```bash
# Install dependencies
pnpm install

# Start development server with hot reload
pnpm dev

# Type checking
pnpm typecheck          # All code
pnpm typecheck:node     # Main process only
pnpm typecheck:web      # Renderer only

# Linting and formatting
pnpm lint
pnpm format

# Add UI components
pnpm ui-add
```

## Building

```bash
# Full production build (includes typecheck)
pnpm build

# Platform-specific builds
pnpm build:win      # Windows
pnpm build:mac      # macOS
pnpm build:linux    # Linux
pnpm build:unpack   # Build without packaging (for testing)
```

## Releasing

Releases are cut from a `v*` git tag. The tag triggers
`.github/workflows/release.yml`, which builds on an Apple Silicon runner, signs
with the Developer ID certificate, notarizes with Apple and publishes the
artifacts to the matching GitHub Release:

- `taac-<version>-arm64.dmg` — what users download for a first install
- `Taac-<version>-arm64-mac.zip` + `latest-mac.yml` — the auto-update payload
  read by `electron-updater` inside the app

```bash
pnpm release:patch   # 0.1.0 → 0.1.1: typecheck, lint, bump, tag, push
pnpm release:minor
pnpm release:major

pnpm publish:mac     # manual fallback: build + notarize + publish from your Mac
```

Required repository secrets:

| Secret | Purpose |
| --- | --- |
| `MACOS_CERTIFICATE` | Developer ID Application `.p12`, base64-encoded |
| `MACOS_CERTIFICATE_PWD` | Password of that `.p12` |
| `KEYCHAIN_PASSWORD` | Any value — unlocks the temporary CI keychain |
| `APPLE_ID` | Apple ID used for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for that Apple ID |
| `APPLE_TEAM_ID` | 10-character Apple Developer Team ID |

In-app updates are checked 15 s after launch and every 6 hours, downloaded in
the background and installed on restart (toggle in Settings → Updates). In
development the updater is inert unless `TAAC_FORCE_UPDATE_CHECK=1` is set.

## Project Structure

```
Taac/
├── src/
│   ├── main/              # Electron main process
│   │   ├── index.ts       # Entry point
│   │   ├── utils/         # FileSystemManager, configStore
│   │   └── ipc/           # IPC handlers
│   ├── preload/           # Preload scripts & type definitions
│   │   ├── index.ts       # Context bridge APIs
│   │   ├── index.d.ts     # API type definitions
│   │   └── types.ts       # Shared type definitions
│   ├── renderer/          # React frontend
│   │   └── src/
│   │       ├── routes/    # TanStack Router routes
│   │       ├── hooks/     # Custom React hooks
│   │       └── components/
│   └── components/        # Lexical editor components
├── resources/             # App icons and resources
└── electron.vite.config.ts
```

## Configuration Notes

### electron-store ESM Fix

`electron-store` v9+ is a pure ESM module. To work with electron-vite's bundler, it must be excluded from externalized dependencies:

```typescript
// electron.vite.config.ts
main: {
  plugins: [
    externalizeDepsPlugin({
      exclude: ['electron-store']
    })
  ]
}
```

## License

[MIT](LICENSE)
