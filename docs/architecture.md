# Architecture Overview

## System Diagram

```
┌─ ClawChat Desktop / Web App ───────────────────────────┐
│                                                          │
│   Platform Targets                                       │
│   ├── Electron (Windows, macOS, Linux)                   │
│   ├── Web Browser (Vite dev server / static build)       │
│   └── Capacitor (iOS, Android) — planned                 │
│                                                          │
│   Pages                         State (Zustand)          │
│   ├── TodayPage                 ├── useAuthStore         │
│   ├── InboxPage                 ├── useChatStore         │
│   ├── ChatListPage              │   (streaming + CRUD)   │
│   ├── ChatPage                  ├── useModuleStore       │
│   ├── AllTasksPage (Kanban)     │   (todos, events,      │
│   ├── TaskDetailPage            │    memos, kanban)       │
│   ├── EventDetailPage           └── useSettingsStore     │
│   ├── SettingsPage                  (15+ settings)       │
│   ├── SystemPromptPage                                   │
│   └── AdminPage (7-tab dashboard)                                   │
│                                                          │
│   Components                    Shared                   │
│   ├── Layout (sidebar + main)   ├── TaskCard             │
│   ├── kanban/                   ├── Badge                │
│   │   ├── KanbanBoard           ├── Checkbox             │
│   │   ├── KanbanColumn          ├── SectionHeader        │
│   │   └── KanbanCard            ├── EmptyState           │
│   ├── chat-panel/               ├── Icons (Calendar, Memo)│
│   │   ├── ChatPanel             ├── EventCard            │
│   │   ├── ChatInput             ├── SegmentedControl     │
│   │   ├── MessageBubble         ├── Toggle / Slider      │
│   │   └── StreamingIndicator    └── Settings components  │
│   └── ConversationItem                                   │
│                                                          │
│   Services                      Hooks                    │
│   ├── apiClient (Axios)         ├── useRegenerate        │
│   ├── sseClient (SSE)           ├── useDebouncedPersist  │
│   ├── wsClient (WebSocket)      ├── useTodayData         │
│   └── logger                    └── queries/ (React Q.)  │
│                                                          │
│   Styles (_*.css partials)      Utils                    │
│   ├── _reset, _variables        ├── formatters           │
│   ├── _layout, _components      ├── helpers (isDemoMode) │
│   ├── _chat, _pages, _kanban    └── platform detection   │
│   ├── _settings, _utilities                              │
│   └── _capacitor                                         │
│                                                          │
└──────────────────────┬───────────────────────────────────┘
                       │ REST (HTTPS) + SSE Streaming
                       │ User's own server only
┌──────────────────────┼───────────────────────────────────┐
│  Self-Hosted Server  │                                    │
│                      │                                    │
│  FastAPI Backend  (clawchat_server repo)                   │
│  ├── Routers (chat, todo, calendar, memo, attachment,     │
│  │           search, today, admin)                        │
│  ├── Services (ai, orchestrator, todo, calendar, memo)    │
│  └── Models & Schemas (SQLAlchemy async + Pydantic)       │
│                                                           │
│  SQLite Database                                          │
│  ├── conversations, messages                              │
│  ├── todos, events, memos, attachments                    │
│  └── agent_tasks                                          │
│                                                           │
│  File Storage (data/uploads/)                             │
│  └── Uploaded attachments (UUID-named files)              │
│                                                           │
│  LLM Provider                                             │
│  └── Ollama (local) or OpenAI-compatible API (cloud)      │
└───────────────────────────────────────────────────────────┘
```

## Design Principles

### 1. Self-Hosted & Privacy-First
All data stays on the user's server. The app communicates only with this server over HTTPS. No telemetry, no analytics, no third-party data processing.

### 2. Conversation as Interface
Natural language chat is the primary way users interact with all features. Direct manipulation UI (clicking, dragging) remains available as an alternative.

### 3. Unified Data Model
Todos, calendar events, notes, and conversations live in a single SQLite database, enabling cross-module awareness, full-text search, and traceability.

### 4. Cross-Platform from a Single Codebase
One React + TypeScript codebase targets Electron (desktop), web browsers, and Capacitor (mobile — planned). Platform differences are handled via runtime detection (`IS_ELECTRON`, `IS_WEB`, `IS_MOBILE`).

### 5. Local by Default, Cloud by Choice
The system works fully offline with demo data. Cloud services (LLM APIs, server sync) are optional enhancements.

## Data Flow

```
User sends message
    │
    ▼
App ──POST /api/chat/stream──► FastAPI Router
                                    │
                                    ▼
                              Intent Classifier
                              (LLM function call)
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
              Module Service   General Chat    Agent Task
              (todo/cal/memo)  (AI response)   (async work)
                    │               │               │
                    ▼               ▼               ▼
              Execute CRUD    Stream tokens    Queue task
              Return result   via SSE          Notify later
                    │               │
                    └───────┬───────┘
                            ▼
                    App renders response
                    in chat panel
```

## CSS Architecture

All styles use **BEM naming** with a `.cc-` prefix (ClawChat) to avoid collisions:
- Colors are injected as CSS custom properties on `.cc-root` from the theme bridge
- Partials are organized by concern: `_layout.css`, `_components.css`, `_chat.css`, `_kanban.css`, etc.
- Light and dark themes swap CSS variable values — components reference variables, never hardcoded colors
- Responsive breakpoints handle desktop-to-mobile transitions (e.g., kanban columns stack at 768px)

## State Management

Five Zustand stores manage all client state:

| Store | Responsibility |
|-------|---------------|
| `useAuthStore` | JWT tokens, server URL, login/logout (persisted to localStorage) |
| `useChatStore` | Conversations, messages, SSE streaming, abort controller |
| `useModuleStore` | Todos, events, memos, kanban statuses, kanban filters, CRUD + async API actions |
| `useSettingsStore` | Theme, chat behavior, LLM params, panel sizes, notifications (persisted to localStorage) |
| `useToastStore` | Toast notification queue with auto-dismiss (success/error/info/warning) |

All stores use optimistic updates with server sync. Demo data is seeded when no server is configured.

A `keyboard/` module provides centralized shortcut definitions (`registry.ts`) and semantic hooks (`hooks.ts`) for global, kanban, and navigation shortcuts using `react-hotkeys-hook`.

### State Management Architecture

The architecture splits state responsibilities between specialized tools (completed in Phase 2):

| Layer | Tool | Responsibility |
|-------|------|---------------|
| **Server state** | TanStack Query (React Query) | Handles API data fetching, caching, background refetch, and optimistic mutations |
| **UI state** | Zustand | Manages filters, panel sizes, theme, and local-only preferences |
| **Validation** | Zod | Validates API responses and form inputs at runtime |

This mirrors the pattern used in production by vibe-kanban, where Zustand handles UI preferences and React Query handles all server-side data with intelligent caching. See [roadmap.md](./roadmap.md) Phase 2 for details.
