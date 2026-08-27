# Development Roadmap

ClawChat development progress and planned work.

Active foundation work is tracked separately from release status:

| Workstream                             | Implemented | Validated                                                             | Released |
| -------------------------------------- | ----------- | --------------------------------------------------------------------- | -------- |
| Canonical task status                  | Yes         | Backend/Web/Android generated-contract and serialization checks       | No       |
| Normalized task relationships          | Yes         | Backend/Web/migration regression checks                               | No       |
| Versioned AI plan proposals            | Yes         | Backend/Web/OpenAPI/migration/concurrency regression checks           | No       |
| Deterministic execution graph insights | Yes         | Backend/Web/algorithm/performance regression checks                   | No       |
| First-class Project identity           | Yes         | Backend/Web/OpenAPI/fresh-migration checks                            | No       |
| Unified Review Inbox and Artifacts     | Yes         | Backend/Web/OpenAPI/version-lifecycle checks                          | No       |
| AgentTask / AgentRun lifecycle         | Yes         | Backend/Web/cancellation/retry/restart/migration checks               | No       |
| Paseo execution provider               | Yes         | CLI contract/provider routing/reconnect/cancel/artifact/review checks | No       |
| Inbox task placement canvas            | Yes         | Backend/Web/OpenAPI/migration/revision/undo checks                    | No       |
| Inbox dependency connectors            | Yes         | Backend/Web/OpenAPI/revision/cycle/impact-preview checks              | No       |
| Atomic Inbox batch triage              | Yes         | Backend/Web/OpenAPI/order/rollback/shared-undo checks                 | No       |
| AI Inbox triage preview                | Yes         | Backend/Web/OpenAPI/strict-ID/revision/grouped-apply/undo checks      | No       |
| AI-proposed Inbox Workstreams          | Yes         | Backend/Web/proposal-reference/rollback/creation-aware-undo checks    | No       |
| Task execution telemetry overlay       | Yes         | Backend/Web/OpenAPI/project-scope/realtime invalidation checks        | No       |

---

## Completed

### Cross-Platform Restructure

- [x] Migrate from React Native (Expo) to Vite + React + TypeScript
- [x] Tauri 2 integration for desktop (Windows, macOS, Linux); legacy Electron shell retired
- [x] Native Kotlin/Compose Android client; Capacitor retained provisionally for iOS
- [x] Shared-client platform detection runtime (`IS_TAURI`, `IS_WEB`, `IS_MOBILE`)
- [x] Unified monorepo structure (`src/app/`, `src/styles/`, `src-tauri/`)

### UI Framework

- [x] React Router v7 with nested layout routes
- [x] Sidebar navigation (Today, Inbox, Chats, All Tasks, Settings)
- [x] Persistent collapsible chat panel
- [x] CSS architecture: BEM naming (`.cc-` prefix), CSS custom properties for theming
- [x] Light/Dark/System theme support via CSS variable swapping
- [x] Responsive design with mobile breakpoints

### Task Management

- [x] Kanban board on All Tasks page (Todo / In Progress / Done / Cancelled columns)
- [x] @hello-pangea/dnd drag-and-drop with smooth animations and drop placeholders
- [x] Kanban filter/sort bar (search, priority chips, tag dropdown, sort selector)
- [x] Visual feedback: drag-over column highlights, card box-shadow + rotation
- [x] Server-native `in_progress` status — no client-side mapping workaround needed
- [x] Checkbox toggle moves tasks between Todo/Done using the server status
- [x] Quick capture modal with natural language input (tasks, events)
- [x] Responsive kanban: columns stack vertically below 768px
- [x] Task detail editing (title, priority, due date, tags, description)
- [x] Today dashboard with greeting, task sections, overdue items
- [x] Inbox page for unscheduled tasks
- [x] Inbox triage split view with Project/Work Tree placement
- [x] Atomic Project/parent/sibling placement with graph-revision conflict detection
- [x] Conservative server-side placement Undo and touch-friendly placement controls
- [x] Separate dependency connector drag with mobile/keyboard prerequisite picker
- [x] Revision-safe dependency impact preview with explainable cycle rejection
- [x] Ordered Inbox multi-selection with atomic batch placement and shared Undo
- [x] Revision-bound AI placement preview with selective, multi-destination atomic apply
- [x] Dashed AI Workstream proposals with atomic creation, Task placement, and shared Undo
- [x] Task-level Agent Run, pending Review, and Artifact overlays in the Inbox Tree and Inspector
- [x] Demo data seeding (15 sample tasks across all columns)

### AI Chat

- [x] SSE streaming (Server-Sent Events) with real-time token rendering
- [x] Dual-path messaging: orchestrator via `/send` + WebSocket when connected, SSE `/stream` fallback
- [x] Streaming indicator (animated 3-dot typing)
- [x] Stop generation (AbortController)
- [x] Message actions: copy, delete, edit, regenerate
- [x] User/assistant message bubbles with hover action menus
- [x] Chat avatar icons: SparkleIcon for AI (left), person icon for user (right) — 28px circular badges
- [x] Conversation list with avatars and previews
- [x] Auto-generate conversation titles (via orchestrator WS `conversation_updated` + SSE `title_generated`)
- [x] Action cards in chat: visual feedback for CRUD actions, scheduling, search results, task delegation
- [x] Intent labels on assistant messages (created task, searched events, daily briefing, etc.)

### State Management (Zustand)

- [x] `useAuthStore` — JWT auth, server URL, token refresh, persisted
- [x] `useChatStore` — Conversations, messages, dual-path streaming (SSE + WebSocket), abort, action metadata
- [x] `useModuleStore` — local todo/event view preferences and kanban filters
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
- [x] Full-text search page across tasks, events, messages
- [x] Toast feedback on task move, toggle, create

### Infrastructure

- [x] Axios API client with auth interceptor and JWT token refresh
- [x] Platform-aware `apiClient` (skips fetch when no server configured)
- [x] Date/time formatters and grouping utilities
- [x] TypeScript strict mode — zero type errors

### Server Alignment (v0.2.0)

- [x] Server (`server/`) fully aligned with client types
- [x] SSE streaming endpoint (`POST /api/chat/stream`) matching client's `sseClient.ts`
- [x] Message edit (`PUT`) and delete (`DELETE`) endpoints
- [x] Ollama native streaming support (`/api/chat` NDJSON)
- [x] Client TS types match server Pydantic schemas (PaginatedResponse, ConversationResponse, TodoResponse, EventResponse, MessageResponse with metadata)
- [x] Canonical server task status with persisted `in_progress` / `cancelled`, OpenAPI enum, generated TypeScript/Kotlin contracts, and no client override
- [x] Async business services (todo, calendar) in server
- [x] Orchestrator wired to real service calls (not stubs)

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
- [x] Native notifications and tray lifecycle via Tauri

### Phase 2: Core Quality & Reliability

> _These upgrades improve the entire app's reliability and developer experience before adding new features._

#### TanStack Query (React Query) — Server State Management

- [x] Install `@tanstack/react-query` v5
- [x] Replace manual Axios + Zustand fetching in `useModuleStore` with `useQuery`/`useMutation`
- [x] Benefits: automatic caching, background refetch, stale-while-revalidate, loading/error states, retry logic
- [x] Keep Zustand for UI-only state (filters, panel sizes, theme); move all API data to React Query
- [x] Add `QueryClientProvider` in `App.tsx`

#### Zod Runtime Validation

- [x] Install `zod` v3
- [x] Add Zod schemas for all API response types (`TodoResponse`, `EventResponse`, `MessageResponse`, etc.)
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

> _These features bring ClawChat's task system closer to a professional project management tool._

#### Sub-tasks (Hierarchical Tasks)

- [x] Add `parent_id` field to `TodoResponse` and `TodoCreate` types
- [x] Server: add `parent_id` column to todos table (nullable foreign key to self, `ON DELETE SET NULL`)
- [x] UI: render sub-tasks as collapsible children under parent tasks in kanban
- [x] Kanban: show/hide sub-tasks toggle in filter bar
- [x] Task detail page: section to add/view/manage sub-tasks with QuickCaptureModal
- [x] Inbox: indent sub-tasks under their parent

#### Task Dependencies

- [x] Keep the Todo `depends_on` JSON array as a deprecated compatibility shadow
- [x] Add normalized `task_relationships` table and API
- [x] Migrate existing `depends_on` data without loss
- [x] Reject self-edges, duplicates, dangling references, and dependency cycles
- [x] Derive Ready/Blocked state, blocker propagation, critical path, deadline risk, and graph health from canonical dependency edges
- [x] Persist project/mode-specific Graph node positions, viewport, and collapsed nodes locally
- [x] Provide a Graph layout reset without changing canonical task or relationship data

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

> _Reusable content-editing groundwork plus the shipped system-prompt editor._

#### Rich Text Editor (Lexical)

- [x] Install `lexical` + `@lexical/react` + `@lexical/markdown`
- [x] Lexical rich text editor component
- [x] Support: bold, italic, headings, bullet lists, code blocks, links
- [x] Markdown import/export
- [ ] Integrate the reusable editor into a persisted task/document workflow

#### CodeMirror for System Prompt Editor

- [x] Install `@uiw/react-codemirror` + `@codemirror/lang-markdown` + `@codemirror/theme-one-dark`
- [x] Replace textarea on SystemPromptPage with CodeMirror editor
- [x] Syntax highlighting, line numbers, word wrap
- [x] Dark mode support via `oneDark` theme (reads from useSettingsStore)
- [ ] Optional: use for JSON settings editor too

#### File Attachments

- [x] Server: file upload endpoint (`POST /api/attachments`) with local storage
- [x] UI: drag-and-drop file upload zone on task detail page
- [x] Attachment list with preview (images) and download links
- [x] Size limits and allowed file type validation

### Phase 6: Mobile

- [x] Native Android app with Compose feature modules, widgets, notifications, and background work
- [x] Bottom navigation for native Android and the shared mobile layout
- [x] Complete Android release CI validation for the canonical task contract
- [ ] Touch-optimize the provisional Capacitor iOS kanban
- [x] Retain Capacitor iOS packaging while native iOS priority is undecided
- [x] Deprecate Capacitor Android; no new product work targets it

### Phase 7: Polish & Deploy

- [x] Offline support (queue actions, sync on reconnect)
- [x] Signed Tauri auto-update
- [x] Production Docker deployment
- [x] Keyboard shortcuts for navigation _(completed)_
- [x] Performance optimization — see below

#### Performance & UX Polish

- [ ] Add list virtualization/windowing for long chat histories and task lists
- [x] `framer-motion` animations for page transitions, panel open/close, toast popups
- [x] Loading skeletons/placeholders for pages while data fetches

#### Component Architecture Refactor

- [x] Adopt Container → View → Primitive pattern for complex components
  - **Containers**: manage state, call hooks, pass data down (e.g., `CalendarContainer`, `AdminContainer`, `TodayContainer`)
  - **Views**: stateless, receive props, handle layout (e.g., `KanbanBoardView`, `TodayView`, `MonthView`, `WeekView`)
  - **Primitives**: reusable UI atoms (buttons, inputs, badges — in `shared/`)
- [x] Extract large page components into smaller sub-components
  - CalendarPage (517 → 1 line): `utils/calendarUtils.ts`, `hooks/useCalendarNavigation.ts`, `calendar-views/` (7 files)
  - AdminPage (457 → 1 line): `formatters.ts` additions, `admin-views/` (9 files)
  - SettingsPage (328 → 190 lines): `hooks/useSettingsExportImport.ts`
  - KanbanBoard (237 → 80 lines): `hooks/useKanbanKeyboardNav.ts`, `hooks/useKanbanDragDrop.ts`, `kanban/KanbanBoardView.tsx`
  - TodayPage (219 → 1 line): `hooks/useTodayProgress.ts`, `hooks/useTodayBriefing.ts`, `hooks/useTodayHotkeys.ts`, `today-views/` (2 files)
  - Pages are thin re-exports; `router.tsx` unchanged; 146 tests pass; 0 type errors

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

### Phase 9: Obsidian Vault Integration & Agent Personas

- [x] Obsidian CLI wrapper (`obsidian_cli_service.py`) using official `key=value` parameter syntax
- [x] CLI operations: create, append, rename, move, search, files, commands
- [x] Filesystem fallback when CLI is unavailable
- [x] Write queue for offline operations (persist to disk, replay on reconnect)
- [x] Vault indexer with periodic re-scan and companion node health check
- [x] Obsidian context service: project folder discovery, related document loading
- [x] Export service: todos → vault markdown with `@agent()` tags and `<!-- claw:id -->` markers
- [x] Vault agent service: AI-powered vault-aware task planning
- [x] Obsidian REST API: health, index, CLI commands, queue management
- [x] LiveSync / CouchDB support (`OBSIDIAN_SYNC_MODE=livesync`)
- [x] Inbox pipeline service: LLM-based todo classification and persona suggestion
- [x] Agent personas: `planner` (subtask breakdown), `researcher` (investigation), `executor` (action)
- [x] Task delegation endpoint (`POST /api/todos/:id/delegate`) with background execution
- [x] Organize endpoint (`POST /api/todos/:id/organize`) with correct background session handling
- [x] Versioned Plan API: proposal ID, graph revision, context hash, and stale detection
- [x] Strict plan/schema validation with exact transactional and idempotent apply
- [x] Reversible change sets with conservative undo and durable Vault sync outbox
- [x] Plan review UI: diff, validation, stale/legacy fail-closed handling, and Undo
- [x] TaskCard persona badges: unified indigo badges (AI / Plan / Research / Exec) for all agent assignees
- [x] TaskDetailPage: persona buttons, delegation actions, "Run Planner" button
- [x] Obsidian export: `@agent(planner|researcher|executor|openclaw)` annotations in vault markdown

---

## Future Considerations

- **Internationalization (i18next)** — Multi-language UI support using `i18next` + `react-i18next` with locale files
- **Google Calendar bidirectional sync**
- **Voice input** (speech-to-text)
- ~~**Web dashboard** for server admin~~ _(completed — Phase 8)_
- **Multi-language AI responses**
- **End-to-end encryption**
- **Plugin system** for community modules
- **OAuth login** — GitHub/Google OAuth as alternative to PIN auth
- **Real-time sync** — ElectricSQL or WebSocket-based live sync between devices
- **Analytics (opt-in)** — Privacy-respecting usage analytics with PostHog (self-hosted) for understanding feature usage
- **Tailwind CSS migration** — Replace raw BEM CSS with Tailwind + class-variance-authority for faster styling velocity (significant effort, defer until needed)
