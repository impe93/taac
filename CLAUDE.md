# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TaacNotes is an AI-native note-taking desktop application built with Electron 35, React 19, and the TanStack ecosystem. It uses MDXEditor for rich text editing, Redux Toolkit for state management, and local AI features with node-llama-cpp for RAG (Retrieval Augmented Generation).

## MCP Usage

### Context7

Always use context7 when I need code generation, setup or configuration steps, or library/API documentation. This means you should automatically use the Context7 MCP tools to resolve library id and get library docs without me having to explicitly ask.

### Serena

Always use serena when I need to explore the codebase and have a better understanding of any class component or variable and make any semantic search and editing across your entire codebase. To use it you need to call the tool activate_project. You should automatically use the Serena MCP tools to resolve those things without me having to explicitly ask.

## Essential Commands

```bash
pnpm dev                # Start development with hot reload
pnpm typecheck          # Run all TypeScript type checks (node + web)
pnpm typecheck:node     # Main process only
pnpm typecheck:web      # Renderer only
pnpm lint               # Lint codebase (ESLint with --cache)
pnpm format             # Format code with Prettier
pnpm build              # Full production build (includes typecheck)
pnpm build:mac          # Build for macOS
pnpm build:win          # Build for Windows
pnpm build:linux        # Build for Linux
pnpm build:unpack       # Build without packaging (for testing)
pnpm ui-add             # Add new Shadcn/UI components (shadcn "new-york" style)
```

## Architecture

### Electron Three-Process Model

1. **Main Process** (`src/main/`) — Entry: `src/main/index.ts`

   - Managers: `FileSystemManager`, `SpaceManager`, `configStore`
   - AI subsystem: `src/main/ai/` (AIManager, ModelRegistry, EmbeddingService, VectorDBManager, HardwareDetector)
   - IPC handlers: `src/main/ipc/` (fileHandlers, configHandlers, spaceHandlers, aiHandlers)

2. **Preload Scripts** (`src/preload/`)

   - Exposes `window.fileSystem`, `window.config`, `window.space`, `window.platform`
   - Types in `src/preload/types.ts` and `src/preload/index.d.ts`

3. **Renderer Process** (`src/renderer/`)
   - React 19 + TanStack Router (hash history for Electron) + TanStack Query
   - Redux Toolkit for UI state (`src/renderer/src/store/`)
   - Path alias: `@renderer/*` → `src/renderer/src/*`

**IPC Pattern**: All operations go through renderer → preload → IPC → Manager classes

### Multi-Space Architecture

Notes are organized into **Spaces** (max 5), each with isolated data:

- `SpaceManager` (`src/main/utils/spaceManager.ts`) handles CRUD, stores metadata in `spaces/spaces.json`
- Each space has its own `FileSystemManager` instance operating on `{userData}/spaces/{spaceId}/`
- Redux state is per-space in `notesTreeSlice.ts` with `spaces: Record<string, SpaceTreeState>`
- Active space tracked via `useActiveSpace()` hook and persisted in electron-store

### State Management

- **Redux Toolkit** (`src/renderer/src/store/notesTreeSlice.ts`) — Normalized notes/folders state with async thunks for IPC operations, optimistic updates with rollback, persistence middleware saves to electron-store
- **TanStack Query** — Used for spaces list, config, and other async data

### File System Layer

```
{userData}/spaces/
├── spaces.json          # Space metadata
└── {spaceId}/
    ├── notes/           # Notes organized in folders
    │   ├── root/
    │   │   └── metadata.json
    │   └── {folder-id}/
    │       ├── {note-id}.json
    │       └── metadata.json
    ├── assets/          # File attachments (images/, pdfs/, attachments/)
    └── database/        # Per-space SQLite vector database (vectors.db)
```

### AI & RAG Architecture

See `docs/AI_ARCHITECTURE.md` for full design. Key components in `src/main/ai/`:

- **AIManager** (singleton) — Orchestrates LLM init, model loading/unloading, GPU layer optimization
- **ModelRegistry** — Curated models defined statically in `CURATED_MODELS` array
- **EmbeddingService** — Token-based chunking (256 tokens/chunk, 32 overlap), note indexing into VectorDB
- **VectorDBManager** — Per-space sqlite-vec databases (768-dim float vectors, L2 distance)
- **HardwareDetector** — CPU/RAM/GPU/VRAM detection for model recommendations
- **ModelDownloader** — Download with progress tracking
- **ConversationManager** — Chat persistence

**Current Models:**

- Chat: Qwen3-4B-Instruct-2507 Q8 (medium tier), Llama 3.1 8B Q8 (high tier)
- Embedding: nomic-embed-text-v2-moe Q8 (768 dim, multilingual)

**Critical RAG Details:**

- nomic-embed-text-v2-moe **requires task prefixes**: `search_document: ` for docs, `search_query: ` for queries — handled by `embedDocument()` and `embedQuery()` methods; `embedText()` is raw
- Distance-to-relevance conversion: sqlite-vec returns L2 distance; cosine similarity = `1 - dist²/2` (quadratic, NOT linear) because vectors are L2-normalized
- Relevance threshold: 20% cosine similarity in ChatInterface.tsx
- `EmbeddingService.chunkText()` is async (needs model for tokenization via `model.tokenize()`/`detokenize()`)

### TypeScript Configuration

Three tsconfig files:

- `tsconfig.node.json` — Main process/Node.js
- `tsconfig.web.json` — Renderer/React
- `tsconfig.app.json` — Application-specific

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
- Lucide React for icons

### Event Handlers

- Prefix with "handle" (handleClick, handleKeyDown)
- Use proper React event types
- Implement keyboard accessibility

## Important Gotchas

### Electron-Specific

- Must use hash history (`createHashHistory`) not browser history
- `electron-store` ESM fix: excluded from externalized deps in `electron.vite.config.ts`
- Window uses `titleBarStyle: 'hiddenInset'` for native macOS look

### Native AI Modules

- `node-llama-cpp` is ESM-only — must use dynamic `import()` and **type-only** imports at the top level
- Native modules (`node-llama-cpp`, `better-sqlite3`, `sqlite-vec`) are explicitly externalized in `electron.vite.config.ts` via both `externalizeDepsPlugin({ include: [...] })` and `rollupOptions.external`
- `AIManager.getModelInstance()` exposes `LlamaModel` for tokenization access outside the AI subsystem

### Known Issues

- Pre-existing typecheck errors in `src/renderer/src/components/providers.tsx` (unused devtools imports) — not introduced by us

### Drag-and-Drop

- Notes tree uses @dnd-kit/core with 10px threshold, auto-expand folders on 1.5s hover
- Optimistic Redux updates with automatic rollback on errors
- Validates against circular dependencies for folder moves

### Editor

- MDXEditor components in `src/components/blocks/editor-00/`
- Editor UI components in `src/components/editor/`
