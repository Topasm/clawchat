# Frontend Guide

The ClawChat frontend is built with React 18, TypeScript, and Vite. It runs in browsers and in a Tauri 2 desktop shell.

## Directory Structure

```
src/
├── main.tsx                           # React entry point
├── App.tsx                            # Root: ThemeProvider + Router
├── router.tsx                         # React Router v7 route definitions
├── app/
│   ├── types/
│   │   ├── api.ts                     # API request/response interfaces (Pydantic mirrors)
│   │   ├── schemas.ts                # Zod schemas for API validation
│   │   └── platform.ts               # Platform detection (Tauri, Web)
│   ├── generated/contracts/
│   │   └── taskStatus.ts             # Generated canonical task-status values (do not edit)
│   ├── stores/
│   │   ├── useAuthStore.ts           # Auth state: JWT, serverUrl, login/logout (persisted) + ConnectionStatus type (canonical)
│   │   ├── useChatStore.ts           # Chat: conversations, messages, SSE streaming
│   │   ├── useModuleStore.ts         # Local module filters and view preferences
│   │   ├── useSettingsStore.ts       # Settings: theme, LLM, chat, panel sizes (persisted)
│   │   └── useToastStore.ts          # Toast notification queue with auto-dismiss
│   ├── pages/
│   │   ├── TodayPage.tsx             # Dashboard: greeting, tasks, events, inbox count
│   │   ├── InboxPage.tsx             # Capture queue + Project/Work Tree triage canvas
│   │   ├── ChatListPage.tsx          # Conversation history list
│   │   ├── ChatPage.tsx              # Full-screen AI conversation
│   │   ├── AllTasksPage.tsx          # Kanban board (renders KanbanBoard)
│   │   ├── TaskDetailPage.tsx        # Task editing + persona delegation (planner/researcher/executor)
│   │   ├── CalendarPage.tsx          # Calendar view (week/month)
│   │   ├── EventDetailPage.tsx       # Event editing (time, location)
│   │   ├── SearchPage.tsx            # Full-text search across tasks, events, messages
│   │   ├── SettingsPage.tsx          # All settings (7 sections)
│   │   ├── SystemPromptPage.tsx      # LLM system prompt editor (CodeMirror)
│   │   ├── AdminPage.tsx             # Admin dashboard (7 tabs: overview, AI, DB, activity, sessions, config, data)
│   │   ├── LoginPage.tsx             # PIN-based authentication
│   │   └── OnboardingPage.tsx        # Onboarding/setup flow
│   ├── components/
│   │   ├── Layout.tsx                # Sidebar + resizable panels + chat panel + shortcuts
│   │   ├── kanban/
│   │   │   ├── KanbanBoard.tsx       # Board: DragDropContext, filter bar, 4 status columns
│   │   │   ├── KanbanColumn.tsx      # Droppable column with drag-over highlight
│   │   │   ├── KanbanCard.tsx        # Draggable card wrapper (@hello-pangea/dnd)
│   │   │   └── KanbanFilterBar.tsx   # Search, priority chips, tag dropdown, sort
│   │   ├── inbox/
│   │   │   └── InboxTriageTree.tsx   # Single/batch placement, sibling insertion, dependency targets
│   │   ├── chat-panel/
│   │   │   ├── ChatPanel.tsx         # Collapsible bottom chat panel
│   │   │   ├── ChatInput.tsx         # Textarea + send/stop buttons
│   │   │   ├── ChatPanelMessages.tsx # Message list (column-reverse)
│   │   │   ├── MessageBubble.tsx     # User/assistant bubble with avatar icons and actions
│   │   │   └── StreamingIndicator.tsx # Animated 3-dot typing indicator
│   │   └── shared/
│   │       ├── TaskCard.tsx          # Task row: checkbox + title + badge meta + persona badges
│   │       ├── Badge.tsx             # Pill badge with SVG priority icons
│   │       ├── Checkbox.tsx          # Circular animated checkbox
│   │       ├── SectionHeader.tsx     # Collapsible section with chevron + count
│   │       ├── EmptyState.tsx        # Icon + message placeholder
│   │       ├── EventCard.tsx         # Event display with time + location
│   │       ├── ConversationItem.tsx  # Chat list row with avatar + preview
│   │       ├── SegmentedControl.tsx  # Multi-option toggle
│   │       ├── Toggle.tsx            # On/off switch
│   │       ├── Slider.tsx            # Range input with value display
│   │       ├── SettingsRow.tsx       # Label + control settings row
│   │       ├── SettingsSection.tsx   # Settings group container
│   │       ├── Dialog.tsx            # Reusable animated dialog (@radix-ui/react-dialog)
│   │       ├── ConfirmDialog.tsx     # Confirm/cancel dialog with danger variant
│   │       ├── CommandPalette.tsx    # Ctrl+K command menu (cmdk + Radix)
│   │       ├── ShortcutsHelp.tsx     # Keyboard shortcuts help dialog (?)
│   │       ├── Icons.tsx             # Shared SVG icons (CalendarIcon, MemoIcon, SparkleIcon, etc.)
│   │       ├── ErrorBoundary.tsx     # App-level error boundary with fallback UI
│   │       ├── Toast.tsx             # Single toast notification item
│   │       ├── ToastContainer.tsx    # Fixed bottom-right toast container (React portal)
│   │       ├── QuickCaptureModal.tsx # Natural language task/event creation
│   │       ├── RichTextEditor.tsx   # Lexical rich text editor (markdown round-trip)
│   │       ├── CodeEditor.tsx       # CodeMirror wrapper with dark mode
│   │       ├── FileDropZone.tsx     # Drag-and-drop file upload zone
│   │       └── AttachmentList.tsx   # Attachment list with preview + download
│   ├── keyboard/
│   │   ├── index.ts                  # Barrel export
│   │   ├── registry.ts              # Shortcut definitions with scopes
│   │   └── hooks.ts                 # useGlobalShortcuts, useKanbanShortcuts, useNavigationShortcuts
│   ├── hooks/
│   │   ├── useAutoLogin.ts          # Tauri host-sidecar auto-login
│   │   ├── useCalendarNavigation.ts # Calendar week/month navigation
│   │   ├── useChatPanel.ts          # Chat panel open/close state
│   │   ├── useCommandPalette.ts     # Command palette open/close + Ctrl+K listener
│   │   ├── useDataSync.ts           # Centralized data sync on app startup
│   │   ├── useDebouncedPersist.ts   # Debounced optimistic persist for detail pages
│   │   ├── useKanbanDragDrop.ts     # Kanban drag-and-drop logic
│   │   ├── useKanbanFilters.ts      # Kanban filter/sort via useMemo
│   │   ├── useKanbanKeyboardNav.ts  # Kanban keyboard navigation
│   │   ├── useNetworkStatus.ts      # Network connectivity detection
│   │   ├── usePairing.ts           # Device pairing flow
│   │   ├── usePlatform.ts           # Platform detection (mobile/desktop/web)
│   │   ├── useRegenerate.ts         # Chat message regeneration (shared by ChatPage + ChatPanel)
│   │   ├── useSettingsExportImport.ts # Settings JSON export/import
│   │   ├── useTodayBriefing.ts      # Today AI briefing integration
│   │   ├── useTodayData.ts          # Today dashboard data aggregation
│   │   ├── useTodayHotkeys.ts       # Today page keyboard shortcuts
│   │   ├── useTodayProgress.ts      # Today progress calculation
│   │   ├── useTouchSelect.ts        # Touch-based multi-select
│   │   ├── useWebSocket.ts          # WebSocket connection + real-time events
│   │   └── queries/
│   │       ├── useChatQueries.ts    # React Query hooks for chat data
│   │       ├── useModuleQueries.ts  # React Query hooks for todos/events
│   │       ├── useAdminQueries.ts   # React Query hooks for admin dashboard (6 queries + 5 mutations)
│   │       ├── useObsidianQueries.ts # React Query hooks for Obsidian vault
│   │       ├── useTodayQuery.ts     # Today dashboard query with greeting
│   │       └── queryKeys.ts         # Centralized React Query keys
│   ├── services/
│   │   ├── apiClient.ts             # Axios with auth interceptor + token refresh
│   │   ├── sseClient.ts            # SSE streaming for chat responses
│   │   ├── wsClient.ts             # WebSocket for real-time sync
│   │   ├── platform.ts             # Platform detection + secure storage
│   │   ├── logger.ts               # Structured logging utility
│   │   └── offlineQueue.ts         # Offline action queue (sync on reconnect)
│   ├── config/
│   │   ├── theme.ts                # Color palettes (light/dark) + ColorPalette type
│   │   ├── ThemeContext.tsx         # React context for theme colors
│   │   ├── ThemeProvider.tsx        # Theme provider with system detection
│   │   ├── constants.ts            # App constants (DEFAULT_SERVER_URL)
│   │   └── queryClient.ts          # React Query client configuration
│   └── utils/
│       ├── helpers.ts             # Shared utilities (isDemoMode, isTextInput)
│       ├── formatters.ts          # Date/time formatting, greeting, formatShortDateTime
│       └── naturalLanguageParser.ts # Parse natural input into task/event
├── styles/
│   ├── index.css                     # Main entry: imports all partials
│   ├── _reset.css                    # Box-sizing, scrollbar, font smoothing
│   ├── _variables.css                # .cc-root base styles
│   ├── _layout.css                   # Sidebar, main area, resize handles, shortcuts help
│   ├── _components.css               # Cards, badges, checkbox, sections, buttons
│   ├── _chat.css                     # Bubbles, chat panel, input, streaming dots
│   ├── _kanban.css                   # 3-column grid, columns, DnD drag states, responsive
│   ├── _kanban-filter.css            # Filter bar, search input, chips, dropdowns
│   ├── _toast.css                    # Toast slide-in animation, type variants
│   ├── _dialog.css                   # Dialog overlay fade-in, content zoom-in
│   ├── _command-palette.css          # Command palette input, list, groups, items
│   ├── _pages.css                    # Page headers, detail pages, chat page
│   ├── _settings.css                 # Toggle, slider, segmented control, settings rows
│   ├── _utilities.css                # Margin, flex, gap helpers
│   ├── _mobile.css                   # Safe-area insets, touch affordances, compact shell
│   ├── _editor.css                   # Lexical RTE, CodeMirror, drop zone, attachments
│   └── _admin.css                    # Admin dashboard tabs, stat cards, activity feed, tables
└── src-tauri/                        # Rust desktop shell and native commands
```

## Navigation

React Router v7 with a nested layout route:

```
/ → redirect to /today
/today             → TodayPage
/inbox             → InboxPage
/chats             → ChatListPage
/chats/:id         → ChatPage (full screen, hides chat panel)
/tasks             → AllTasksPage (Kanban board)
/tasks/:id         → TaskDetailPage
/calendar          → CalendarPage (week/month view)
/events/:id        → EventDetailPage
/search            → SearchPage
/settings          → SettingsPage
/settings/system-prompt → SystemPromptPage
/admin             → AdminPage
/login             → LoginPage
/onboarding        → OnboardingPage
```

All routes are wrapped in `<Layout />` which provides the sidebar, resizable panels, chat panel, command palette, and toast container.

## State Management

### useModuleStore

Manages todos, events, kanban board state, and kanban filters:

```typescript
// Key state
kanbanFilters: { searchQuery, priorities[], tags[], sortField, sortDirection }
events: EventResponse[]

// Key actions
setKanbanSearchQuery(query)        // Filter kanban by text
toggleKanbanPriorityFilter(p)      // Toggle priority filter chip
toggleKanbanTagFilter(tag)         // Toggle tag filter
setKanbanSort(field, direction)    // Change sort field/direction
clearKanbanFilters()               // Reset all filters
```

Todos are server state managed by TanStack Query. Kanban mutations persist the exact canonical status (`pending`, `in_progress`, `completed`, or `cancelled`) through the API and optimistically update the query cache. There is no Zustand status override, so list, graph, kanban, Tauri, and Android all observe the same value after refetch or restart.

Task relationships are separate server state under the
`taskRelationships` query key. The Graph and task-detail relationship section
read normalized rows from `/api/task-relationships`; create/delete mutations,
Todo deletion, plan application, and `module_data_changed` WebSocket events all
invalidate that cache. The Graph reverses stored `depends_on` edges only for
display so execution flows from prerequisite to dependent task.

The Inbox Triage Canvas keeps card placement and dependency connectors on
separate drag transfer types. Dragging `↝` from a dependent Task onto its
prerequisite opens a server-derived impact preview; touch and keyboard users
choose the same prerequisite from the Inspector. Confirming uses the preview's
base graph revision, then invalidates relationships, Todos, graph insights, and
Projects together.

For batch organization, `AI suggest` requests a read-only placement preview for
the selected queue items. The user can deselect individual recommendations and
apply the rest. Recommendations with different Project/parent destinations are
sent through one grouped placement mutation, producing one revision update and
one Undo. A 409 response dismisses the stale preview and refreshes graph
insights before another attempt.

Proposed Workstreams are rendered as dashed preview nodes. Suggestions refer to
them with preview-local keys, and the client materializes only Workstreams still
referenced by selected suggestions. The pure `buildInboxTriagePlacementGroups`
adapter keeps existing destinations and proposed containers in one ordered
grouped command; no temporary Todo is inserted into the query cache before
server approval.

Execution data stays an overlay rather than becoming Tree structure. The
`useTaskExecutionTelemetryQuery` hook loads one sparse Task projection and the
pure `getTaskExecutionBadges` adapter applies display precedence for active
Runs, input/review waits, failures, and Artifacts. Run, Review, and Artifact
WebSocket changes invalidate the projection; polling is enabled only while an
Agent is actively executing.

`ReadyTaskExecutionPanel` keeps execution approval separate from Task Skill
assignment. It filters out the planning Skill, selects from the server Skill
registry and discovered providers, checks the Paseo workspace prerequisite,
and reveals the Start action only after a review step. The owning mutation
sends the Ready guard and explicit approval, then invalidates Todos, Runs,
Projects, graph insights, and Task execution telemetry together.

`AgentRunReviewHandoff` renders the server-provided approval impact in Review,
then retains the applied outcome after the pending card disappears. Newly Ready
Tasks link directly to their detail pages and the approval mutation invalidates
Graph Insights immediately. Runs exposes Retry and `Return task to queue` only
for the latest Todo-backed unsuccessful attempt while its Todo is still
`in_progress`; the recovery response distinguishes a genuinely Ready Task from
one that returned to the queue in Blocked state.

### useToastStore

```typescript
toasts: Toast[]                    // Queue of active toasts
addToast(type, message)            // Add toast (auto-removes after 3.5s)
removeToast(id)                    // Manually dismiss
```

Types: `success`, `error`, `info`, `warning`. Each renders with a colored left border.

### useAuthStore

```typescript
token: string | null; // JWT access token
refreshToken: string | null; // JWT refresh token
serverUrl: string | null; // User's server URL
login(serverUrl, pin); // POST /api/auth/login
logout(); // Clear all auth state
```

### useChatStore

```typescript
conversations: ConversationResponse[]
messages: ChatMessage[]            // Internal format with _id, text, user
isStreaming: boolean
sendMessageStreaming(id, text)     // SSE streaming with optimistic insert
stopGeneration()                   // AbortController
deleteMessage / editMessage / regenerateMessage
```

### useSettingsStore

15+ persisted settings across: chat behavior, LLM parameters, appearance (theme, sidebarSize, chatPanelSize), notifications, and privacy.

## Kanban Board

The All Tasks page (`/tasks`) renders a 3-column kanban board:

| Column      | Status        | Color                         |
| ----------- | ------------- | ----------------------------- |
| Todo        | `pending`     | Blue highlight on drag-over   |
| In Progress | `in_progress` | Yellow highlight on drag-over |
| Done        | `completed`   | Green highlight on drag-over  |

**Drag and drop**: Uses `@hello-pangea/dnd` for smooth animations and keyboard-accessible dragging.

- `KanbanBoard` wraps columns in `<DragDropContext>` and handles `onDragEnd`
- `KanbanColumn` uses `<Droppable>` with `snapshot.isDraggingOver` for highlight
- `KanbanCard` uses `<Draggable>` with `snapshot.isDragging` for visual feedback
- Visual feedback: dragging card gets box-shadow + subtle rotation, target column gets a colored border glow

**Filter/Sort Bar**: Above the kanban grid, provides:

- Text search across task titles, descriptions, and tags
- Priority toggle chips (urgent/high/medium/low)
- Tag dropdown filter
- Sort by date created, priority, due date, or title (asc/desc)
- Clear button to reset all filters

**Responsive**: Columns stack vertically below 768px viewport width.

## Keyboard Shortcuts

| Key                | Action                        | Scope  |
| ------------------ | ----------------------------- | ------ |
| `Ctrl+K` / `Cmd+K` | Open command palette          | Global |
| `?`                | Show keyboard shortcuts help  | Global |
| `Ctrl+Shift+C`     | Toggle chat panel             | Global |
| `G+T`              | Go to Today                   | Global |
| `G+I`              | Go to Inbox                   | Global |
| `G+C`              | Go to Chats                   | Global |
| `G+A`              | Go to All Tasks               | Global |
| `G+S`              | Go to Settings                | Global |
| `N`                | New task (opens QuickCapture) | Kanban |
| `/`                | Focus search input            | Kanban |
| `Esc`              | Close dialog / palette        | Dialog |

Shortcuts are defined in `keyboard/registry.ts` and wired via hooks in `keyboard/hooks.ts`.

## Command Palette

Opened with `Ctrl+K`, the command palette provides:

- **Navigation** — Jump to any page (Today, Inbox, Chats, Tasks, Calendar, Settings)
- **Actions** — Toggle dark/light theme
- **Tasks** — Search across todo titles, click to navigate to task detail

Built with `cmdk` (headless command menu) rendered inside a `@radix-ui/react-dialog`.

## Dialog System

Reusable dialog components wrapping `@radix-ui/react-dialog`:

- `Dialog` — Base component with animated overlay (fade-in) and content (zoom-in), focus trap, ESC to close
- `ConfirmDialog` — Convenience wrapper with confirm/cancel buttons and danger variant
- `ShortcutsHelp` — Lists all keyboard shortcuts grouped by scope

## CSS Architecture

All classes use BEM naming with `.cc-` prefix:

```
.cc-kanban                    → Board grid
.cc-kanban__column            → Column container
.cc-kanban__column--todo      → Todo variant
.cc-kanban__column--drag-over → Active drop target
.cc-kanban__header            → Column header
.cc-kanban__card              → Draggable card wrapper
.cc-kanban__card--dragging    → Box-shadow + rotation while dragging
.cc-toast                     → Toast notification
.cc-toast--success            → Green left border
.cc-dialog__overlay           → Modal backdrop
.cc-cmd-palette               → Command palette container
.cc-resize-handle             → Panel resize handle (primary color on hover)
```

Colors are injected as CSS custom properties on `.cc-root`:

- `--cc-background`, `--cc-surface`, `--cc-text`, `--cc-primary`, `--cc-success`, etc.
- Light/dark themes swap variable values; components never use hardcoded colors

## Platform Detection

Runtime detection inside the shared React client:

```typescript
IS_TAURI     // running inside the Tauri shell
IS_DESKTOP   // desktop runtime reported by the platform adapter
IS_WEB       // not the desktop runtime
IS_MOBILE    // always false: no supported runtime reports as mobile
detectPlatform(): 'web' | 'tauri'
```

Web and Tauri are the only runtimes of this client. The compact `.cc-root--mobile` shell (bottom navigation, swipe tabs, mobile status bar) is still in the tree but unreachable while `IS_MOBILE` is false; re-enable it from a real signal rather than reintroducing a platform flag. Native Android is a separate Kotlin/Compose client under `android/` and does not use this renderer.

## API Types

API responses are validated with Zod schemas in `types/schemas.ts`, with
TypeScript types inferred via `z.infer<>` and re-exported from `types/api.ts`.
The canonical `TaskStatus` and `TaskRelationshipType` values are generated
from FastAPI's checked-in OpenAPI snapshot; Android's Kotlin enums come from
the same source.

Run `npm run generate:api` after changing a server schema. CI checks both the
OpenAPI snapshot and generated runtime enum contracts for drift.

```typescript
TodoResponse    { id, title, description, status, priority, due_date, completed_at, tags, depends_on?, created_at, updated_at }
TodoCreate      { title, description?, status?, priority?, due_date?, tags?, depends_on? }
TaskRelationshipResponse { id, source_task_id, target_task_id, type, label?, created_by, proposal_id?, created_at, updated_at }
EventResponse   { id, title, description, start_time, end_time, location, is_all_day, reminder_minutes, recurrence_rule, tags, created_at, updated_at }
ConversationResponse { id, title, last_message, is_archived?, created_at, updated_at }
MessageResponse { id, conversation_id, role, content, message_type?, created_at }
AttachmentResponse { id, filename, stored_filename, content_type, size_bytes, todo_id, url, created_at }
SearchResponse  { items: SearchHit[], total, page, limit }  // Paginated
TodayResponse   { today_tasks, overdue_tasks, today_events, inbox_count, greeting, date }

// Admin Dashboard
AdminOverviewResponse { server: ServerOverview, counts: TableCounts, storage: StorageStats }
AIConfigResponse      { provider, model, base_url, connected, available_models[] }
AITestResponse        { connected, latency_ms?, error? }
ActivityResponse      { recent: RecentActivity[], agent_tasks: AgentTaskSummary[] }
SessionsResponse      { active_connections: ActiveSession[], total_connections }
ServerConfigResponse  { host, port, database_url, jwt_expiry_hours, ai_provider, ai_base_url, ai_model, ... }
DataOverviewResponse  { modules: ModuleDataOverview[] }
PurgeResponse         { deleted_count, target }
ReindexResponse       { status, tables_reindexed[] }
BackupResponse        { filename, size_bytes }
```

## Development

```bash
npm run dev           # Vite dev server (web)
npm run dev:tauri     # Tauri + Vite
npm run typecheck     # npx tsc --noEmit
npm run build         # Production build
npm run generate:api  # Refresh OpenAPI + generated TS/Kotlin contracts
uv run --project server --locked python scripts/export-openapi.py --check # Verify snapshot
npm run check:api-contract # Verify generated TS/Kotlin values
```

Demo mode activates automatically when no server URL is configured — all pages show seeded sample data.
