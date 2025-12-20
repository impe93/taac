# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TaacNotes is an AI-native note-taking desktop application built with Electron, React 19, and the TanStack ecosystem. The project uses Lexical for rich text editing and follows a modern TypeScript-first architecture.

## MCP Usage

### Context7

Always use context7 when I need code generation, setup or configuration steps, or library/API documentation. This means you should automatically use the Context7 MCP tools to resolve library id and get library docs without me having to explicitly ask.

### Serena

Always use serena when I need to explore the codebase and have a better understanding of any class component or variable and make any semantic search and editing across your entire codebase. To use it you need to call the tool activate_project. You should automatically use the Serena MCP tools to resolve those things without me having to explicitly ask.

## Essential Commands

### Development

```bash
pnpm dev                # Start development with hot reload
pnpm typecheck          # Run all TypeScript type checks
pnpm typecheck:node     # Type check Node/Electron main process
pnpm typecheck:web      # Type check renderer/React code
pnpm lint               # Lint codebase
pnpm format             # Format code with Prettier
```

### Building

```bash
pnpm build              # Full production build (includes typecheck)
pnpm build:win          # Build for Windows
pnpm build:mac          # Build for macOS
pnpm build:linux        # Build for Linux
pnpm build:unpack       # Build without packaging (for testing)
```

### UI Development

```bash
pnpm ui-add             # Add new Shadcn/UI components
```

## Architecture

### Electron Three-Process Model

1. **Main Process** (`src/main/`)

   - Entry point: `src/main/index.ts`
   - Manages app lifecycle, window creation, and native OS integration
   - Uses `@electron-toolkit/utils` for common Electron patterns
   - IPC handlers defined here (currently basic ping/pong example)

2. **Preload Scripts** (`src/preload/`)

   - Bridge between main and renderer with context isolation
   - Exposes safe APIs via `contextBridge`
   - Type definitions in `index.d.ts`

3. **Renderer Process** (`src/renderer/`)
   - React 19 application with TypeScript
   - Uses TanStack Router with hash-based history (required for Electron)
   - All UI code lives here

### Frontend Architecture

**Router Configuration** (`src/renderer/src/main.tsx`):

- Uses `createHashHistory()` for Electron compatibility (not browser history)
- File-based routing with TanStack Router
- Route tree auto-generated in `routeTree.gen.ts`
- Routes use `layout.tsx` token for nested layouts

**Route Structure**:

```
src/renderer/src/routes/
├── __root.tsx           # Root layout with providers and sidebar
├── index.tsx            # Home page
├── dashboard/
│   ├── layout.tsx       # Dashboard-specific layout
│   └── index.tsx
└── settings/
    └── index.tsx
```

**Providers Setup** (`src/renderer/src/components/providers.tsx`):

- TanStack Query for data fetching/caching
- next-themes for dark/light mode
- Shadcn/UI Sidebar provider
- Development-only devtools (Router & Query)
- Toast notifications with Sonner

**Editor System** (`src/components/`):

- Lexical-based rich text editor (not in `src/renderer/`)
- Custom editor blocks in `src/components/blocks/editor-00/`
- Reusable editor UI components in `src/components/editor/`
- Theme configuration in `src/components/editor/themes/`

### TypeScript Configuration

Three separate tsconfig files for different parts:

- `tsconfig.node.json` - Main process/Node.js code
- `tsconfig.web.json` - Renderer/React code
- `tsconfig.app.json` - Application-specific config

Path alias: `@renderer/*` maps to `src/renderer/src/*`

### Build Configuration

**Electron Vite** (`electron.vite.config.ts`):

- Main process: Node externalization
- Preload: Node externalization
- Renderer:
  - TanStack Router plugin with auto code-splitting
  - TailwindCSS v4 Vite plugin
  - React plugin
  - `@renderer` path alias

## Code Standards (from .cursorrules)

### TypeScript

- Use explicit return types for functions and components
- Define interfaces for component props
- Leverage Zod for validation
- Avoid implicit `any` types
- Use type inference where it improves readability

### React Components

- Functional components with explicit prop interfaces
- Prefer `const` arrow functions over function declarations
- Use early returns for better readability
- Implement proper loading and error states
- Follow accessibility best practices (ARIA labels, keyboard navigation)

### Event Handlers

- Prefix with "handle" (e.g., `handleClick`, `handleKeyDown`)
- Use proper event types (`React.MouseEvent`, `React.KeyboardEvent`, etc.)
- Implement keyboard accessibility for interactive elements

### Styling

- TailwindCSS v4 exclusively (no custom CSS unless in theme files)
- Use Shadcn/UI components from `src/renderer/src/components/ui/`
- Use `clsx`/`cn` utility for conditional classes
- Prefer `className` over style props
- Mobile-first responsive design

### State Management

- TanStack Query for server state
- Standard React hooks for local state
- Implement proper caching strategies
- Use `React.memo` strategically

### Code Organization

```tsx
// Standard component structure:
import { type FC } from 'react'
import { useQuery } from '@tanstack/react-query'

interface ComponentProps {
  id: string
  className?: string
}

export const Component: FC<ComponentProps> = ({ id, className }) => {
  // Queries/hooks
  // Event handlers
  // Early returns
  // Render
}
```

## Important Notes

### Electron-Specific

- Must use hash history (`createHashHistory`) not browser history
- Preload scripts bridge main/renderer with context isolation
- Window configuration uses `titleBarStyle: 'hiddenInset'` for native look
- Development uses HMR via `ELECTRON_RENDERER_URL` env var

### Editor Implementation

- Lexical editor components are NOT in `src/renderer/` but in `src/components/`
- Editor blocks are modular and located in `src/components/blocks/`
- Custom theme configuration in `src/components/editor/themes/`

### Shadcn/UI Configuration

- Registry includes custom `@shadcn-editor` for editor components
- Style: "new-york"
- Uses CSS variables for theming
- Icon library: Lucide React
- Add components via `pnpm ui-add`

### Development Workflow

- Always run `pnpm typecheck` before building
- Separate type checking for Node and Web code
- Use ESLint with Electron-specific config
- Prettier for code formatting
