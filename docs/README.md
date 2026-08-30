# ClawChat Documentation

ClawChat is a privacy-first, self-hosted AI project execution workspace that unifies tasks, dependency graphs, calendar, documents, agents, and chat. Web/Tauri and native Android clients share one FastAPI contract and a user-owned SQLite database.

## Documentation Index

| Document                                                                                       | Description                                                                                               |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [Architecture Overview](./architecture.md)                                                     | System design, data flow, and design principles                                                           |
| [Platform Matrix](./architecture/platform-matrix.md)                                           | Supported clients, ownership boundaries, and release validation                                           |
| [Database Schema](./database-schema.md)                                                        | Core tables, supporting persistence, indexes, and migration strategy                                      |
| [API Design](./api-design.md)                                                                  | Human-readable REST/SSE/WebSocket guide and contract-generation workflow                                  |
| [Backend Guide](./backend-guide.md)                                                            | FastAPI project structure, modules, and dev setup                                                         |
| [Frontend Guide](./frontend-guide.md)                                                          | Vite + React + TypeScript app structure and component reference                                           |
| [Tauri Migration](./tauri-migration.md)                                                        | Desktop runtime architecture, data migration, updater, and signing                                        |
| [Android Release](./android-release.md)                                                        | Signed Android releases, GitHub-release publishing, and the in-app updater                                |
| [Electron Cutover](./electron-cutover.md)                                                      | Completed removal record and legacy data-import guarantees                                                |
| [Build Performance](./build-performance.md)                                                    | Renderer/native build layers and performance budgets                                                      |
| [Deployment](./deployment.md)                                                                  | Docker setup, environment variables, and production config                                                |
| [Remote Access Runbook](./remote-access-runbook.md)                                            | Cloudflare Tunnel (primary) and Tailscale (secondary) remote access setup                                 |
| [Roadmap](./roadmap.md)                                                                        | Development progress and upcoming work (includes vibe-kanban-inspired upgrades)                           |
| [Upgrade Reference](./upgrade-reference.md)                                                    | Libraries, patterns, and code examples for planned upgrades                                               |
| [ADR 003: Task Status](./adr/003-task-status-source-of-truth.md)                               | Why task lifecycle state is server-owned and generated for every client                                   |
| [ADR 004: Task Relationships](./adr/004-task-relationship-model.md)                            | Direction, validation, migration, and compatibility policy for task edges                                 |
| [ADR 005: Versioned AI Plans](./adr/005-versioned-ai-plan-proposals.md)                        | Proposal identity, graph revisions, transactional apply, conservative undo, and Vault outbox policy       |
| [ADR 006: Execution Graph Insights](./adr/006-deterministic-execution-graph-insights.md)       | Canonical Ready/Blocked semantics, critical path, deadline risk, scope, and graph health                  |
| [ADR 011: Atomic Inbox Placement](./adr/011-atomic-inbox-task-placement.md)                    | Inbox-to-Tree placement semantics, graph-revision concurrency, subtree moves, and conservative undo       |
| [ADR 012: Previewed Dependency Connectors](./adr/012-previewed-inbox-dependency-connectors.md) | Separate connector semantics, impact preview, cycle explanations, and revision-safe apply                 |
| [ADR 013: Atomic Batch Inbox Placement](./adr/013-atomic-batch-inbox-placement.md)             | Ordered multi-selection, all-or-nothing placement, shared impact, and one-step Undo                       |
| [ADR 014: AI Inbox Triage Preview](./adr/014-ai-inbox-triage-preview.md)                       | Strict existing-location recommendations, revision-safe approval, grouped atomic apply, and shared Undo   |
| [ADR 015: AI-Proposed Workstreams](./adr/015-ai-proposed-workstreams.md)                       | Dashed structural proposals, preview-local references, atomic creation/placement, and creation-aware Undo |
| [ADR 016: Task Execution Telemetry](./adr/016-task-execution-telemetry-overlay.md)             | Derived Task-level Run, Review, and Artifact overlays without duplicating canonical execution state       |
| [ADR 017: Approved Agent Execution](./adr/017-ready-only-approved-agent-execution.md)          | Ready-only, provider-aware, single-Run execution with an explicit user confirmation gate                  |
| [ADR 018: Agent Review Handoff](./adr/018-agent-review-ready-handoff.md)                        | CAS review decisions, downstream Ready handoff, and explicit unsuccessful-Run recovery                    |

## Key Features

- **AI Chat with Streaming** — Real-time token-by-token AI response streaming using Server-Sent Events (SSE) with typing indicator and stop generation support
- **Kanban Task Board** — Drag-and-drop kanban board (Todo / In Progress / Done / Cancelled) with server-persisted status, smooth animations, and filter/sort controls
- **Task Graph** — Project hierarchy and execution-dependency views backed by parent/child links and normalized relationship edges
- **Inbox Triage Canvas** — Place captured Tasks into a Project hierarchy, approve AI suggestions, connect dependencies, and inspect live Run, Review, and Artifact overlays
- **Approved Agent Execution** — Start one provider-aware Run from a Ready leaf Task after reviewing its Skill and lifecycle impact
- **Review-to-Ready Handoff** — Preview downstream unlocks, approve one Agent result, and continue directly with newly Ready Tasks
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
- **Obsidian Project Documents** — Vault indexing, project context, queued CLI writes, and task/plan export for user-owned Markdown files
- **CodeMirror System Prompt Editor** — Syntax-highlighted editor with line numbers, word wrap, and dark mode support for the system prompt page
- **File Attachments** — Drag-and-drop task attachments with image preview, download links, and size/type validation (10MB limit)
- **Full-Text Search** — Server search across tasks, events, and messages; the current search page presents task and event results
- **Dialog System** — Accessible animated modals using @radix-ui/react-dialog with focus trap and ESC support
- **Cross-Platform** — Runs through Tauri on desktop, native Compose on Android, and Vite in browsers
- **Private Remote Access** — Publish via Cloudflare Tunnel or Tailscale without exposing the backend directly to the internet
- **Demo Mode** — Fully functional UI with seeded demo data when no backend is connected

## Integration Notes

- ClawChat itself does not depend on Telegram.
- Telegram is only relevant if OpenClaw is also being used as a chat bot in a separate channel.
- ClawChat talks to `clawchat_server` over HTTPS, SSE, and WebSocket, and the server talks to OpenClaw over loopback.

## Tech Stack

| Layer              | Technology                                   | Purpose                                                                    |
| ------------------ | -------------------------------------------- | -------------------------------------------------------------------------- |
| Desktop App        | Tauri 2 + Rust                               | Native desktop shell, server lifecycle, secure storage, and signed updates |
| Web App            | Vite + React 18                              | Fast dev server and optimized production builds                            |
| Language           | TypeScript                                   | Type-safe codebase                                                         |
| Routing            | React Router v7                              | Client-side navigation and lazy route splitting                            |
| Client State       | Zustand + TanStack Query                     | Local preferences/session state plus cached server state and mutations     |
| HTTP Client        | Axios                                        | REST API communication with token refresh                                  |
| Real-time          | SSE + WebSocket                              | Streaming AI responses and cross-client change notifications               |
| Drag & Drop        | @hello-pangea/dnd                            | Kanban board drag-and-drop with animations                                 |
| Dialogs            | @radix-ui/react-dialog                       | Accessible modal/dialog primitives                                         |
| Command Palette    | cmdk                                         | Headless command menu                                                      |
| Keyboard Shortcuts | react-hotkeys-hook                           | Global and scoped hotkey management                                        |
| Resizable Panels   | react-resizable-panels                       | Adjustable sidebar/panel layout                                            |
| Code Editor        | @uiw/react-codemirror                        | Syntax-highlighted editor for system prompt                                |
| Styling            | CSS with custom properties                   | BEM naming (`.cc-` prefix), theme-aware via CSS variables                  |
| Backend            | Python FastAPI                               | Async API server with AI orchestration                                     |
| Database           | SQLite                                       | Single-file, zero-config persistent storage                                |
| AI Layer           | Ollama / OpenAI-compatible / Claude Code / Codex API | Local-first LLM with optional external backends                      |
| Deployment         | Docker Compose                               | One-command server setup                                                   |

## Quick Start

```bash
# Install frontend/backend dependencies and create .env
make setup

# Development (web + API)
make dev

# Development (Tauri desktop)
npm run dev:tauri

# Type checking
npm run typecheck

# Production build
npm run build

# After changing a FastAPI schema
npm run generate:api
```

## Prerequisites

- **Node.js** >= 22 and npm >= 10 (Node 24 LTS recommended)
- **Python** >= 3.11 and **uv** 0.10.2 (for the server)
- **Docker & Docker Compose** (for server deployment)
- An AI backend for AI features: **Ollama**, an **OpenAI-compatible endpoint**, **Claude Code**, or the **Codex API**
