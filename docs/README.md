# ClawChat Documentation

ClawChat is a privacy-first, self-hosted personal assistant that unifies task management, calendar, notes, and AI-powered conversation into a single cross-platform desktop and web app backed by a user-owned server.

## Documentation Index

| Document | Description |
|----------|-------------|
| [Architecture Overview](./architecture.md) | System design, data flow, and design principles |
| [Database Schema](./database-schema.md) | All tables, columns, indexes, and migration strategy |
| [API Design](./api-design.md) | REST endpoints, SSE streaming, and authentication |
| [Backend Guide](./backend-guide.md) | FastAPI project structure, modules, and dev setup |
| [Frontend Guide](./frontend-guide.md) | Vite + React + TypeScript app structure and component reference |
| [Deployment](./deployment.md) | Docker setup, environment variables, and production config |
| [Roadmap](./roadmap.md) | Development progress and upcoming work (includes vibe-kanban-inspired upgrades) |
| [Upgrade Reference](./upgrade-reference.md) | Libraries, patterns, and code examples for planned upgrades |

## Key Features

- **AI Chat with Streaming** — Real-time token-by-token AI response streaming using Server-Sent Events (SSE) with typing indicator and stop generation support
- **Kanban Task Board** — Drag-and-drop kanban board (Todo / In Progress / Done) with @hello-pangea/dnd, smooth animations, drop placeholders, and filter/sort bar
- **Command Palette (Ctrl+K)** — Quick navigation and action launcher using cmdk, search across tasks, pages, and actions
- **Keyboard Shortcuts** — Global and scoped hotkeys (?, N, /, Ctrl+Shift+C, G+T/I/C/A/S) using react-hotkeys-hook
- **Toast Notifications** — User feedback on task moves, completions, and creation with auto-dismiss
- **Resizable Panels** — Adjustable sidebar width via react-resizable-panels (fixed layout on mobile)
- **Priority Icons** — Arrow-based SVG icons for priority badges (urgent/high/medium/low)
- **Dark Mode** — Light/Dark/System theme support with CSS custom properties, applied across all components
- **Message Interactions** — Copy, regenerate, edit, and delete messages with context menus
- **Configurable Settings** — 15+ user-configurable settings (chat behavior, LLM parameters, appearance, notifications) with JSON export/import
- **Today Dashboard** — Greeting, today's tasks, overdue items, events, and inbox count at a glance
- **Calendar Integration** — Event management with time, location, and detail editing
- **Rich Text Memos (Lexical)** — Notes with bold, italic, headings, lists, code blocks, and links powered by Lexical rich text editor with markdown round-trip storage
- **CodeMirror System Prompt Editor** — Syntax-highlighted editor with line numbers, word wrap, and dark mode support for the system prompt page
- **File Attachments** — Drag-and-drop file upload on memos and tasks with image preview, download links, and size/type validation (10MB limit)
- **Full-Text Search** — Search across tasks, events, and memos from a dedicated search page
- **Dialog System** — Accessible animated modals using @radix-ui/react-dialog with focus trap and ESC support
- **Cross-Platform** — Runs as an Electron desktop app (Windows/macOS/Linux) and as a web app in any browser
- **Demo Mode** — Fully functional UI with seeded demo data when no backend is connected

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Desktop App | Electron | Native desktop shell (Windows, macOS, Linux) |
| Web App | Vite + React 18 | Fast dev server and optimized production builds |
| Language | TypeScript | Type-safe codebase |
| Routing | React Router v6 | Client-side navigation |
| State Management | Zustand | Lightweight global state (auth, chat, modules, settings) |
| HTTP Client | Axios | REST API communication with token refresh |
| Real-time | SSE (Server-Sent Events) | Streaming AI responses |
| Drag & Drop | @hello-pangea/dnd | Kanban board drag-and-drop with animations |
| Dialogs | @radix-ui/react-dialog | Accessible modal/dialog primitives |
| Command Palette | cmdk | Headless command menu |
| Keyboard Shortcuts | react-hotkeys-hook | Global and scoped hotkey management |
| Resizable Panels | react-resizable-panels | Adjustable sidebar/panel layout |
| Rich Text Editor | Lexical + @lexical/react | Markdown-based rich text editing for memos |
| Code Editor | @uiw/react-codemirror | Syntax-highlighted editor for system prompt |
| Styling | CSS with custom properties | BEM naming (`.cc-` prefix), theme-aware via CSS variables |
| Backend | Python FastAPI | Async API server with AI orchestration |
| Database | SQLite | Single-file, zero-config persistent storage |
| AI Layer | Ollama / OpenAI-compatible API | Local-first LLM with cloud fallback |
| Deployment | Docker Compose | One-command server setup |

## Quick Start

```bash
# Install dependencies
npm install

# Development (web)
npm run dev

# Development (Electron desktop)
npm run dev:electron

# Type checking
npm run typecheck

# Production build
npm run build
```

## Prerequisites

- **Node.js** >= 18 and npm
- **Python** >= 3.11 (for the server)
- **Docker & Docker Compose** (for server deployment)
- An **OpenAI-compatible LLM** endpoint (Ollama for local, or Claude/GPT API key)
