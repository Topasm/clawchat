# Development Roadmap

ClawChat development progress and planned work.

---

## Completed

### Cross-Platform Restructure
- [x] Migrate from React Native (Expo) to Vite + React + TypeScript
- [x] Electron integration for desktop (Windows, macOS, Linux)
- [x] Capacitor scaffolding for future mobile builds (iOS, Android)
- [x] Platform detection runtime (`IS_ELECTRON`, `IS_WEB`, `IS_MOBILE`)
- [x] Unified monorepo structure (`src/app/`, `src/styles/`, `electron/`)

### UI Framework
- [x] React Router v6 with nested layout routes
- [x] Sidebar navigation (Today, Inbox, Chats, All Tasks, Settings)
- [x] Persistent collapsible chat panel
- [x] CSS architecture: BEM naming (`.cc-` prefix), CSS custom properties for theming
- [x] Light/Dark/System theme support via CSS variable swapping
- [x] Responsive design with mobile breakpoints

### Task Management
- [x] Kanban board on All Tasks page (Todo / In Progress / Done columns)
- [x] @hello-pangea/dnd drag-and-drop with smooth animations and drop placeholders
- [x] Kanban filter/sort bar (search, priority chips, tag dropdown, sort selector)
- [x] Visual feedback: drag-over column highlights, card box-shadow + rotation
- [x] Server-native `in_progress` status — no client-side mapping workaround needed
- [x] Checkbox toggle moves tasks between Todo/Done, clears kanban overrides
- [x] Quick capture modal with natural language input (tasks, events, memos)
- [x] Responsive kanban: columns stack vertically below 768px
- [x] Task detail editing (title, priority, due date, tags, description)
- [x] Today dashboard with greeting, task sections, overdue items
- [x] Inbox page for unscheduled tasks
- [x] Demo data seeding (15 sample tasks across all columns)

### AI Chat
- [x] SSE streaming (Server-Sent Events) with real-time token rendering
- [x] Dual-path messaging: orchestrator via `/send` + WebSocket when connected, SSE `/stream` fallback
- [x] Streaming indicator (animated 3-dot typing)
- [x] Stop generation (AbortController)
- [x] Message actions: copy, delete, edit, regenerate
- [x] User/assistant message bubbles with hover action menus
- [x] Conversation list with avatars and previews
- [x] Auto-generate conversation titles (via orchestrator WS `conversation_updated` + SSE `title_generated`)
- [x] Action cards in chat: visual feedback for CRUD actions, scheduling, search results, task delegation
- [x] Intent labels on assistant messages (created task, searched events, daily briefing, etc.)

### State Management (Zustand)
- [x] `useAuthStore` — JWT auth, server URL, token refresh, persisted
- [x] `useChatStore` — Conversations, messages, dual-path streaming (SSE + WebSocket), abort, action metadata
- [x] `useModuleStore` — Todos, events, memos, kanban statuses, async API actions
- [x] `useSettingsStore` — 15+ settings, theme, LLM params, persisted
- [x] Optimistic updates with server sync fallback

### Settings
- [x] Chat settings (font size, bubble style, send on enter, timestamps)
- [x] LLM settings (model, temperature, system prompt, max tokens)
- [x] Appearance (theme toggle, compact mode)
- [x] Notifications (enable/disable, reminder sound)
- [x] Privacy (save history, analytics)
- [x] JSON settings export/import
- [x] System prompt editor page

### Shared Components
- [x] TaskCard, Badge with SVG priority icons (priority/due/tag/status/count variants)
- [x] Checkbox (circular, animated), SectionHeader (collapsible)
- [x] EmptyState, EventCard, ConversationItem
- [x] SegmentedControl, Toggle, Slider
- [x] SettingsRow, SettingsSection
- [x] Dialog system (@radix-ui/react-dialog) with ConfirmDialog
- [x] Command palette (Ctrl+K) using cmdk
- [x] Toast notification system (success/error/info/warning with auto-dismiss)
- [x] Keyboard shortcuts help dialog (?)
- [x] Utility classes (margin, flex, gap)

### UI Polish
- [x] Keyboard shortcuts: Ctrl+K, ?, Ctrl+Shift+C, N, /, G+T/I/C/A/S (react-hotkeys-hook)
- [x] Resizable sidebar via react-resizable-panels (fixed layout on mobile)
- [x] Full-text search page across tasks, events, memos
- [x] Memos page with CRUD and tagging
- [x] Toast feedback on task move, toggle, create

### Infrastructure
- [x] Axios API client with auth interceptor and JWT token refresh
- [x] Platform-aware `apiClient` (skips fetch when no server configured)
- [x] Date/time formatters and grouping utilities
- [x] TypeScript strict mode — zero type errors

### Server Alignment (v0.2.0)
- [x] Standalone server (`clawchat_server`) fully aligned with client types
- [x] Removed embedded `clawchat/server/` — standalone server is the only backend
- [x] SSE streaming endpoint (`POST /api/chat/stream`) matching client's `sseClient.ts`
- [x] Message edit (`PUT`) and delete (`DELETE`) endpoints
- [x] Ollama native streaming support (`/api/chat` NDJSON)
- [x] Client TS types match server Pydantic schemas (PaginatedResponse, ConversationResponse, TodoResponse, EventResponse, MemoResponse, MessageResponse with metadata)
- [x] Server todo status supports `in_progress` / `cancelled` — client kanban uses server status directly
- [x] Async business services (todo, calendar, memo) in standalone server
- [x] Orchestrator wired to real service calls (not stubs)
- [x] Memo types include `title` field on both client and server

### Calendar & Events
- [x] Event creation flow from UI (form + date picker)
- [x] Calendar view (week/month)
- [x] Event reminders

### Code Quality & Refactoring (v0.3.1)
- [x] Extract shared utilities: `isDemoMode()`, `isTextInput()`, `formatShortDateTime()` into `utils/helpers.ts` and `formatters.ts`
- [x] Extract shared hooks: `useRegenerate`, `useDebouncedPersist` to eliminate duplicated logic
- [x] Extract shared `Icons.tsx` component (CalendarIcon, MemoIcon) from Layout and ActionCard
- [x] Consolidate `ConnectionStatus` type — single definition in `useAuthStore`, imported by `wsClient`
- [x] Replace duplicated `greetingForHour()` with shared `getGreeting()` from formatters
- [x] Fix `SearchResponseSchema` to match backend's paginated `{items, total, page, limit}` format
- [x] Remove dead code: unused exports, orphaned `TagAutocomplete` component, unused constants
- [x] Clean unused type re-exports from `api.ts`
- [x] Server: Extract `serialize_tags`/`deserialize_tags` utilities — replaced 21+ inline `json.loads`/`json.dumps`
- [x] Server: Add `apply_model_updates()` utility — eliminated duplicated CRUD update loops in 3 services
- [x] Server: Extract `strip_markdown_fences()` — replaced inline markdown stripping in 2 services
- [x] Server: Consolidate `SYSTEM_PROMPT` into shared `constants.py`
- [x] Server: Refactor `generate_title()` to delegate to `generate_completion()` (25 → 9 lines)
- [x] Server: Remove dead code (`get_queued_tasks`, `confirm_action` intent, unused schemas)

### AI Features (Phase 5)
- [x] Chat-to-action: create tasks/events from conversation (orchestrator → UI refresh via WebSocket `module_data_changed`)
- [x] Daily morning briefing generation (orchestrator `daily_briefing` intent)
- [x] Cross-module full-text search (`/api/search` with FTS5, orchestrator `search` intent)
- [x] Auto-generate conversation titles (orchestrator `conversation_updated` WS event + SSE `title_generated`)
- [x] Dual-path messaging: `/send` (orchestrator + WebSocket streaming) with `/stream` (SSE) fallback
- [x] Server `MessageResponse` schema includes `metadata` field (parsed from `metadata_json` ORM column)
- [x] WebSocket handlers for `stream_start`, `stream_chunk`, `stream_end`, `conversation_updated`
- [x] Action cards in chat for 19+ orchestrator intents (CRUD, scheduling, search, delegation)

---

## Planned

### Phase 1: Live Integration
- [x] End-to-end testing with live server
- [x] Live data replacing demo seeds on connection
- [x] Push notifications via Electron tray

### Phase 2: Core Quality & Reliability
> *These upgrades improve the entire app's reliability and developer experience before adding new features.*

#### TanStack Query (React Query) — Server State Management
- [x] Install `@tanstack/react-query` v5
- [x] Replace manual Axios + Zustand fetching in `useModuleStore` with `useQuery`/`useMutation`
- [x] Benefits: automatic caching, background refetch, stale-while-revalidate, loading/error states, retry logic
- [x] Keep Zustand for UI-only state (filters, panel sizes, theme); move all API data to React Query
- [x] Add `QueryClientProvider` in `App.tsx`

#### Zod Runtime Validation
- [x] Install `zod` v3
- [x] Add Zod schemas for all API response types (`TodoResponse`, `EventResponse`, `MemoResponse`, `MessageResponse`, etc.)
- [x] Validate API responses at the boundary (in `apiClient.ts` or per-query)
- [x] Add Zod schemas for form inputs (task creation, event creation, settings)
- [x] Replace manual form validation with Zod `.safeParse()`

#### Error Boundaries
- [x] Add `<ErrorBoundary>` wrapper around the main layout with a user-friendly fallback UI
- [x] Add per-page error boundaries for isolation (a crash in Calendar shouldn't break Chat)
- [ ] Optional: Sentry integration for production error tracking (privacy-respecting, self-hosted Sentry)

#### Unit & Integration Tests
- [x] Install Vitest + @testing-library/react
- [x] Add tests for Zustand stores (auth, chat, module, settings)
- [x] Add tests for utility functions (formatters, naturalLanguageParser)
- [x] Add component tests for shared components (TaskCard, Badge, Checkbox)
- [ ] Add integration tests for kanban drag-and-drop flow
- [x] Phase 3: 137 tests across 8 files (schemas, stores, hooks, components, services)
- [x] Phase 4: 146 tests across 10 files (+9 tests for attachments, RichTextEditor, FileDropZone)

### Phase 3: Advanced Task Management
> *These features bring ClawChat's task system closer to a professional project management tool.*

#### Sub-tasks (Hierarchical Tasks)
- [x] Add `parent_id` field to `TodoResponse` and `TodoCreate` types
- [x] Server: add `parent_id` column to todos table (nullable foreign key to self, `ON DELETE SET NULL`)
- [x] UI: render sub-tasks as collapsible children under parent tasks in kanban
- [x] Kanban: show/hide sub-tasks toggle in filter bar
- [x] Task detail page: section to add/view/manage sub-tasks with QuickCaptureModal
- [x] Inbox: indent sub-tasks under their parent

#### Task Relationships
- [x] Add task relationship types: `blocks`, `blocked_by`, `related`, `duplicate_of`
- [x] Server: new `task_relationships` table (`id`, `source_todo_id`, `target_todo_id`, `relationship_type`)
- [x] UI: task detail page RelationshipsSection to link related tasks
- [x] Kanban: BlockerBadge visual indicator when a task has blockers

#### Bulk Task Operations
- [x] Add multi-select mode to kanban board (Ctrl/Cmd+click on cards)
- [x] Bulk actions toolbar: change status, change priority, delete (floating BulkActionToolbar)
- [x] Select all / deselect all within a column

#### Enhanced Kanban Sorting & Ordering
- [x] Add sort options: `updated_at`, custom manual order (drag-to-reorder within column)
- [x] Persist custom card order (add `sort_order` field to todos)
- [x] Server: support `sort_order` in todo API (query param + column)
- [x] Drag within a column reorders; drag between columns changes status

### Phase 4: Content & Editing
> *Rich text and code editing for a more capable notes and prompt editing experience.*

#### Rich Text Editor (Lexical)
- [x] Install `lexical` + `@lexical/react` + `@lexical/markdown`
- [x] Replace plain textarea in Memos page with Lexical editor
- [x] Support: bold, italic, headings, bullet lists, code blocks, links
- [x] Markdown import/export (memos stored as markdown on server)
- [ ] Optional: use for task descriptions too

#### CodeMirror for System Prompt Editor
- [x] Install `@uiw/react-codemirror` + `@codemirror/lang-markdown` + `@codemirror/theme-one-dark`
- [x] Replace textarea on SystemPromptPage with CodeMirror editor
- [x] Syntax highlighting, line numbers, word wrap
- [x] Dark mode support via `oneDark` theme (reads from useSettingsStore)
- [ ] Optional: use for JSON settings editor too

#### File Attachments
- [x] Server: file upload endpoint (`POST /api/attachments`) with local storage
- [x] UI: drag-and-drop file upload zone on task detail and memo pages
- [x] Attachment list with preview (images) and download links
- [x] Size limits and allowed file type validation

### Phase 6: Mobile
- [x] Capacitor builds for iOS and Android
- [x] Bottom tab navigation for mobile layout
- [ ] Touch-optimized kanban (touch drag-and-drop)
- [x] Push notifications (Capacitor)

### Phase 7: Polish & Deploy
- [ ] Offline support (queue actions, sync on reconnect)
- [ ] Electron auto-update
- [ ] Production Docker deployment
- [x] Keyboard shortcuts for navigation *(completed)*
- [x] Performance optimization — see below

#### Performance & UX Polish
- [x] Virtual scrolling with `react-virtuoso` for long chat histories and task lists
- [x] `framer-motion` animations for page transitions, panel open/close, toast popups
- [x] Loading skeletons/placeholders for pages while data fetches

#### Component Architecture Refactor
- [ ] Adopt Container → View → Primitive pattern for complex components
  - **Containers**: manage state, call hooks, pass data down (e.g., `KanbanContainer`)
  - **Views**: stateless, receive props, handle layout (e.g., `KanbanBoardView`)
  - **Primitives**: reusable UI atoms (buttons, inputs, badges — already partially done in `shared/`)
- [ ] Extract large page components (CalendarPage, SettingsPage) into smaller sub-components

### Phase 8: Admin Dashboard
- [x] Server: admin schemas (`server/schemas/admin.py`) — 13 Pydantic response/request models
- [x] Server: admin service layer (`server/services/admin_service.py`) — table counts, storage stats, uptime, activity feed, agent task history, module data overview, purge, FTS reindex, DB backup
- [x] Server: admin router (`server/routers/admin.py`) — 11 endpoints (overview, AI config, AI test, activity, sessions, disconnect, config, data, reindex, backup, purge)
- [x] Server: router registered in `main.py` at `/api/admin`
- [x] Client: Zod schemas + inferred types for all admin responses in `schemas.ts`
- [x] Client: admin type re-exports in `api.ts`
- [x] Client: 6 admin query keys in `queryKeys.ts`
- [x] Client: React Query hooks (`useAdminQueries.ts`) — 6 queries (overview at 30s, sessions at 10s auto-refresh) + 5 mutations with toast notifications
- [x] Client: `AdminIcon` (shield SVG) in `NavIcons.tsx`
- [x] Client: `_admin.css` — tab bar, stat cards, activity feed, agent task table, config rows, purge form, model tags
- [x] Client: `AdminPage.tsx` — 7-tab dashboard (Overview, AI Config, Database, Activity, Sessions, Server Config, Data Mgmt)
- [x] Client: `/admin` route in `router.tsx` + nav item in `Layout.tsx`
- [x] Destructive actions (purge, reindex) use `ConfirmDialog` before executing
- [x] Typecheck passes, 146 tests pass

---

## Future Considerations

- **Internationalization (i18next)** — Multi-language UI support using `i18next` + `react-i18next` with locale files
- **Google Calendar bidirectional sync**
- **Voice input** (speech-to-text)
- ~~**Web dashboard** for server admin~~ *(completed — Phase 8)*
- **Multi-language AI responses**
- **End-to-end encryption**
- **Plugin system** for community modules
- **OAuth login** — GitHub/Google OAuth as alternative to PIN auth
- **Real-time sync** — ElectricSQL or WebSocket-based live sync between devices
- **Analytics (opt-in)** — Privacy-respecting usage analytics with PostHog (self-hosted) for understanding feature usage
- **Tailwind CSS migration** — Replace raw BEM CSS with Tailwind + class-variance-authority for faster styling velocity (significant effort, defer until needed)
