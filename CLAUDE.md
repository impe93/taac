# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TaacNotes is an AI-native note-taking desktop application built with Electron 35, React 19, and the TanStack ecosystem. It uses MDXEditor for rich text editing, Redux Toolkit for state management, and is building local AI features with node-llama-cpp for RAG (Retrieval Augmented Generation).

## MCP Usage

### Context7

Always use context7 when I need code generation, setup or configuration steps, or library/API documentation. This means you should automatically use the Context7 MCP tools to resolve library id and get library docs without me having to explicitly ask.

### Serena

Always use serena when I need to explore the codebase and have a better understanding of any class component or variable and make any semantic search and editing across your entire codebase. To use it you need to call the tool activate_project. You should automatically use the Serena MCP tools to resolve those things without me having to explicitly ask.

## Essential Commands

```bash
pnpm dev                # Start development with hot reload
pnpm typecheck          # Run all TypeScript type checks (node + web)
pnpm lint               # Lint codebase
pnpm format             # Format code with Prettier
pnpm build              # Full production build (includes typecheck)
pnpm build:mac          # Build for macOS
pnpm build:win          # Build for Windows
pnpm build:linux        # Build for Linux
pnpm ui-add             # Add new Shadcn/UI components
```

## Architecture

### Electron Three-Process Model

1. **Main Process** (`src/main/`)
   - Entry: `src/main/index.ts`
   - Managers: `FileSystemManager`, `SpaceManager`, `configStore`
   - IPC handlers in `src/main/ipc/` (fileHandlers, configHandlers, spaceHandlers)

2. **Preload Scripts** (`src/preload/`)
   - Exposes `window.fileSystem`, `window.config`, `window.space`, `window.platform`
   - Types in `src/preload/types.ts` and `src/preload/index.d.ts`

3. **Renderer Process** (`src/renderer/`)
   - React 19 + TanStack Router (hash history for Electron)
   - TanStack Query for async data
   - Redux Toolkit for UI state (`src/renderer/src/store/`)

### Multi-Space Architecture

Notes are organized into **Spaces** (max 5), each with isolated data:
- `SpaceManager` (`src/main/utils/spaceManager.ts`) handles CRUD, stores metadata in `spaces/spaces.json`
- Each space has its own `FileSystemManager` instance operating on `{userData}/spaces/{spaceId}/`
- Redux state is per-space in `notesTreeSlice.ts` with `spaces: Record<string, SpaceTreeState>`
- Active space tracked via `useActiveSpace()` hook and persisted in electron-store

### State Management

**Redux Toolkit** (`src/renderer/src/store/`):
- `notesTreeSlice.ts` - Normalized notes/folders state with async thunks for IPC operations
- Multi-space state: each space has its own folders, notes, expandedFolders, selectedNoteId
- Optimistic updates with rollback for move operations
- Persistence middleware saves to electron-store for instant hydration on restart

**TanStack Query** - Used for spaces list, config, and other async data

### File System Layer

**Directory Structure** (`{userData}/`):
```
spaces/
├── spaces.json          # Space metadata
└── {spaceId}/
    ├── notes/           # Notes organized in folders
    │   ├── root/
    │   │   └── metadata.json
    │   └── {folder-id}/
    │       ├── {note-id}.json
    │       └── metadata.json
    ├── assets/          # File attachments (images/, pdfs/, attachments/)
    └── database/        # SQLite vector database
```

**IPC Pattern**: All file operations go through preload → IPC → FileSystemManager

### Drag-and-Drop System

Notes tree (`src/renderer/src/components/notes-tree/`) uses @dnd-kit/core:
- 10px threshold before drag activates (allows normal clicks)
- Auto-expand folders after 1.5s hover
- Optimistic Redux updates with automatic rollback on errors
- Validates against circular dependencies for folder moves
- Supports cross-space moves via `moveNoteToSpace` and `moveFolderToSpace`

### AI Architecture (In Development)

See `docs/AI_ARCHITECTURE.md` for full details. Key components:
- `node-llama-cpp` for local LLM inference
- `better-sqlite3` + sqlite-vec for vector search
- `systeminformation` for hardware detection
- Per-space vector databases, global conversation storage

### TypeScript Configuration

Three tsconfig files:
- `tsconfig.node.json` - Main process/Node.js
- `tsconfig.web.json` - Renderer/React
- `tsconfig.app.json` - Application-specific

Path alias: `@renderer/*` → `src/renderer/src/*`

## Code Standards

### TypeScript

- Explicit return types for functions and components
- Interfaces for component props
- Zod for validation
- Avoid implicit `any`

### React Components

```tsx
import { type FC } from 'react'

interface ComponentProps {
  id: string
  className?: string
}

export const Component: FC<ComponentProps> = ({ id, className }) => {
  // Queries/hooks first
  // Event handlers (prefix with "handle")
  // Early returns
  // Render
}
```

### Styling

- TailwindCSS v4 exclusively
- Shadcn/UI components from `src/renderer/src/components/ui/`
- Use `cn` utility for conditional classes
- Mobile-first responsive design

### Event Handlers

- Prefix with "handle" (handleClick, handleKeyDown)
- Use proper React event types
- Implement keyboard accessibility

## Important Notes

### Electron-Specific

- Must use hash history (`createHashHistory`) not browser history
- `electron-store` ESM fix required - exclude from externalized deps in `electron.vite.config.ts`
- Window uses `titleBarStyle: 'hiddenInset'` for native look

### Editor

- MDXEditor components in `src/components/blocks/editor-00/`
- Editor UI components in `src/components/editor/`

### Route Structure

```
src/renderer/src/routes/
├── __root.tsx           # Root layout with providers
├── index.tsx            # Home/notes list
├── note/$noteId.tsx     # Note editor route
├── dashboard/           # Dashboard section
│   ├── layout.tsx
│   └── index.tsx
└── settings/
    └── index.tsx
```

### Shadcn/UI

- Style: "new-york"
- Icon library: Lucide React
- Add components via `pnpm ui-add`
