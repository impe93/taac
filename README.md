# Electron TanStack App

A cross-platform desktop application built with Electron, React 19, and the TanStack ecosystem. This modern stack provides a robust foundation for building performant desktop applications with a beautiful UI.

<img width="900" alt="image" src="https://github.com/user-attachments/assets/1c142933-d2f3-4a6d-8f19-f10e6c147a52" />

## Features

- **Cross-Platform**: Works on Windows, macOS, and Linux
- **Modern UI**: Built with React 19, TailwindCSS v4, and Shadcn/UI components
- **Type-Safe Routing**: Leveraging TanStack Router for file-based routing
- **State Management**: TanStack Query for efficient data fetching and caching
- **Theme Support**: Dark/light mode with next-themes
- **UI Components**: Complete set of accessible UI primitives from Radix UI
- **Form Handling**: Integrated with React Hook Form and Zod validation

## Tech Stack

- **Electron**: Cross-platform desktop framework
- **React 19**: UI library with TypeScript
- **TanStack Router**: Type-safe routing with file-based route organization
- **TanStack Query**: Data fetching and state management
- **Shadcn/UI + Radix**: Component library with accessible primitives
- **TailwindCSS v4**: Utility-first styling
- **Zod**: Schema validation

## Project Structure

```
electron-tanstack-app/
├── src/
│   ├── main/          # Electron main process
│   ├── preload/       # Preload scripts for IPC
│   └── renderer/      # React frontend application
│       └── src/
│           ├── components/  # UI components
│           │   └── ui/      # Shadcn/UI components
│           ├── routes/      # Application routes
│           ├── lib/         # Utilities and helpers
│           ├── hooks/       # Custom React hooks
│           └── assets/      # Application assets
├── resources/         # Application resources
└── ...
```

## Installation

```bash
# Clone the repository
$ git clone https://github.com/yourusername/electron-tanstack-app.git
$ cd electron-tanstack-app

# Install dependencies
$ pnpm install
```

## Development

```bash
# Start the development server with hot reload
$ pnpm dev
```

## Building for Production

```bash
# For Windows
$ pnpm build:win

# For macOS
$ pnpm build:mac

# For Linux
$ pnpm build:linux
```

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Development Tools

- **UI Component Management**: `pnpm ui-add` to add new Shadcn UI components
- **Type Checking**: `pnpm typecheck` to run TypeScript type checking
- **Linting**: `pnpm lint` to lint the codebase
- **Formatting**: `pnpm format` to format code with Prettier

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

[MIT](LICENSE)
