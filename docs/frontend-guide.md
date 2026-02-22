# Frontend Guide

The ClawChat frontend is built with React 18, TypeScript, and Vite. It runs as a web app in any browser and as an Electron desktop app on Windows, macOS, and Linux.

## Directory Structure

```
src/
├── main.tsx                           # React entry point
├── App.tsx                            # Root: ThemeProvider + Router
├── router.tsx                         # React Router v6 route definitions
├── app/
│   ├── types/
│   │   ├── api.ts                     # API request/response interfaces (Pydantic mirrors)
│   │   ├── schemas.ts                # Zod schemas for API validation
│   │   ├── platform.ts               # Platform detection (Electron, Capacitor, Web)
│   │   └── electron.d.ts             # Electron API type declarations
│   ├── stores/
│   │   ├── useAuthStore.ts           # Auth state: JWT, serverUrl, login/logout (persisted) + ConnectionStatus type (canonical)
│   │   ├── useChatStore.ts           # Chat: conversations, messages, SSE streaming
│   │   ├── useModuleStore.ts         # Modules: todos, events, memos, kanban statuses, filters
│   │   ├── useSettingsStore.ts       # Settings: theme, LLM, chat, panel sizes (persisted)
│   │   └── useToastStore.ts          # Toast notification queue with auto-dismiss
│   ├── pages/
│   │   ├── TodayPage.tsx             # Dashboard: greeting, tasks, events, inbox count
│   │   ├── InboxPage.tsx             # Unscheduled tasks (GTD inbox)
│   │   ├── ChatListPage.tsx          # Conversation history list
│   │   ├── ChatPage.tsx              # Full-screen AI conversation
│   │   ├── AllTasksPage.tsx          # Kanban board (renders KanbanBoard)
│   │   ├── TaskDetailPage.tsx        # Task editing (title, priority, due date, tags)
│   │   ├── EventDetailPage.tsx       # Event editing (time, location)
│   │   ├── MemosPage.tsx             # Memo CRUD with Lexical rich text + attachments
│   │   ├── SearchPage.tsx            # Full-text search across tasks, events, memos
│   │   ├── SettingsPage.tsx          # All settings (7 sections)
│   │   ├── SystemPromptPage.tsx      # LLM system prompt editor (CodeMirror)
│   │   ├── AdminPage.tsx             # Admin dashboard (7 tabs: overview, AI, DB, activity, sessions, config, data)
│   │   └── LoginPage.tsx             # PIN-based authentication
│   ├── components/
│   │   ├── Layout.tsx                # Sidebar + resizable panels + chat panel + shortcuts
│   │   ├── kanban/
│   │   │   ├── KanbanBoard.tsx       # Board: DragDropContext, filter bar, 3 columns
│   │   │   ├── KanbanColumn.tsx      # Droppable column with drag-over highlight
│   │   │   ├── KanbanCard.tsx        # Draggable card wrapper (@hello-pangea/dnd)
│   │   │   └── KanbanFilterBar.tsx   # Search, priority chips, tag dropdown, sort
│   │   ├── chat-panel/
│   │   │   ├── ChatPanel.tsx         # Collapsible bottom chat panel
│   │   │   ├── ChatInput.tsx         # Textarea + send/stop buttons
│   │   │   ├── ChatPanelMessages.tsx # Message list (column-reverse)
│   │   │   ├── MessageBubble.tsx     # User/assistant bubble with actions
│   │   │   └── StreamingIndicator.tsx # Animated 3-dot typing indicator
│   │   └── shared/
│   │       ├── TaskCard.tsx          # Task row: checkbox + title + badge meta
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
│   │       ├── Icons.tsx             # Shared SVG icons (CalendarIcon, MemoIcon)
│   │       ├── ErrorBoundary.tsx     # App-level error boundary with fallback UI
│   │       ├── Toast.tsx             # Single toast notification item
│   │       ├── ToastContainer.tsx    # Fixed bottom-right toast container (React portal)
│   │       ├── QuickCaptureModal.tsx # Natural language task/event/memo creation
│   │       ├── RichTextEditor.tsx   # Lexical rich text editor (markdown round-trip)
│   │       ├── CodeEditor.tsx       # CodeMirror wrapper with dark mode
│   │       ├── FileDropZone.tsx     # Drag-and-drop file upload zone
│   │       └── AttachmentList.tsx   # Attachment list with preview + download
│   ├── keyboard/
│   │   ├── index.ts                  # Barrel export
│   │   ├── registry.ts              # Shortcut definitions with scopes
│   │   └── hooks.ts                 # useGlobalShortcuts, useKanbanShortcuts, useNavigationShortcuts
│   ├── hooks/
│   │   ├── useTodayData.ts          # Today dashboard data aggregation
│   │   ├── useChatPanel.ts          # Chat panel open/close state
│   │   ├── usePlatform.ts           # Platform detection (mobile/desktop/web)
│   │   ├── useKanbanFilters.ts      # Kanban filter/sort via useMemo
│   │   ├── useCommandPalette.ts     # Command palette open/close + Ctrl+K listener
│   │   ├── useRegenerate.ts         # Chat message regeneration (shared by ChatPage + ChatPanel)
│   │   ├── useDebouncedPersist.ts   # Debounced optimistic persist for detail pages
│   │   ├── useDataSync.ts           # Centralized data sync on app startup
│   │   ├── useWebSocket.ts          # WebSocket connection + real-time events
│   │   └── queries/
│   │       ├── useChatQueries.ts    # React Query hooks for chat data
│   │       ├── useModuleQueries.ts  # React Query hooks for todos/events/memos
│   │       ├── useAdminQueries.ts   # React Query hooks for admin dashboard (6 queries + 5 mutations)
│   │       ├── useTodayQuery.ts     # Today dashboard query with greeting
│   │       └── queryKeys.ts         # Centralized React Query keys
│   ├── services/
│   │   ├── apiClient.ts             # Axios with auth interceptor + token refresh
│   │   ├── sseClient.ts            # SSE streaming for chat responses
│   │   ├── wsClient.ts             # WebSocket for real-time sync
│   │   ├── platform.ts             # Platform detection + secure storage
│   │   └── logger.ts               # Structured logging utility
│   ├── config/
│   │   ├── theme.ts                # Color palettes (light/dark) + ColorPalette type
│   │   ├── ThemeContext.tsx         # React context for theme colors
│   │   ├── ThemeProvider.tsx        # Theme provider with system detection
│   │   ├── constants.ts            # App constants (DEFAULT_SERVER_URL)
│   │   └── queryClient.ts          # React Query client configuration
│   └── utils/
│       ├── helpers.ts             # Shared utilities (isDemoMode, isTextInput)
│       ├── formatters.ts          # Date/time formatting, greeting, formatShortDateTime
│       └── naturalLanguageParser.ts # Parse natural input into task/event/memo
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
│   ├── _capacitor.css                # Mobile-specific overrides
│   ├── _editor.css                   # Lexical RTE, CodeMirror, drop zone, attachments
│   └── _admin.css                    # Admin dashboard tabs, stat cards, activity feed, tables
└── electron/
    ├── main.ts                       # Electron main process
    └── preload.ts                    # Electron preload (exposes electronAPI)
```

## Navigation

React Router v6 with a nested layout route:

```
/ → redirect to /today
/today         → TodayPage
/inbox         → InboxPage
/chats         → ChatListPage
/chats/:id     → ChatPage (full screen, hides chat panel)
/tasks         → AllTasksPage (Kanban board)
/tasks/:id     → TaskDetailPage
/events/:id    → EventDetailPage
/memos         → MemosPage
/search        → SearchPage
/settings      → SettingsPage
/settings/system-prompt → SystemPromptPage
/admin         → AdminPage
```

All routes are wrapped in `<Layout />` which provides the sidebar, resizable panels, chat panel, command palette, and toast container.

## State Management

### useModuleStore

Manages todos, events, memos, kanban board state, and kanban filters:

```typescript
// Key state
todos: TodoResponse[]              // Seeded with 15 demo tasks
kanbanStatuses: Record<string, KanbanStatus>  // Local in_progress overrides
kanbanFilters: { searchQuery, priorities[], tags[], sortField, sortDirection }
events: EventResponse[]
memos: MemoResponse[]

// Key actions
setKanbanStatus(id, status)        // Move task between kanban columns (+ toast)
toggleTodoComplete(id)             // Toggle + clear kanban override (+ toast)
createTodo(data)                   // POST /todos (+ toast)
fetchTodos(params)                 // GET /todos (skips if no server configured)
setKanbanSearchQuery(query)        // Filter kanban by text
toggleKanbanPriorityFilter(p)      // Toggle priority filter chip
toggleKanbanTagFilter(tag)         // Toggle tag filter
setKanbanSort(field, direction)    // Change sort field/direction
clearKanbanFilters()               // Reset all filters
```

The kanban board uses a **local override pattern**: the server only knows `pending` and `completed` statuses. The `in_progress` status is tracked client-side in `kanbanStatuses`. When a task is moved to "In Progress", its server status remains `pending` but the UI shows it in the correct column.

### useToastStore

```typescript
toasts: Toast[]                    // Queue of active toasts
addToast(type, message)            // Add toast (auto-removes after 3.5s)
removeToast(id)                    // Manually dismiss
```

Types: `success`, `error`, `info`, `warning`. Each renders with a colored left border.

### useAuthStore

```typescript
token: string | null               // JWT access token
refreshToken: string | null        // JWT refresh token
serverUrl: string | null           // User's server URL
login(serverUrl, pin)              // POST /api/auth/login
logout()                           // Clear all auth state
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

| Column | Status | Color |
|--------|--------|-------|
| Todo | `pending` | Blue highlight on drag-over |
| In Progress | `in_progress` | Yellow highlight on drag-over |
| Done | `completed` | Green highlight on drag-over |

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

| Key | Action | Scope |
|-----|--------|-------|
| `Ctrl+K` / `Cmd+K` | Open command palette | Global |
| `?` | Show keyboard shortcuts help | Global |
| `Ctrl+Shift+C` | Toggle chat panel | Global |
| `G+T` | Go to Today | Global |
| `G+I` | Go to Inbox | Global |
| `G+C` | Go to Chats | Global |
| `G+A` | Go to All Tasks | Global |
| `G+S` | Go to Settings | Global |
| `N` | New task (opens QuickCapture) | Kanban |
| `/` | Focus search input | Kanban |
| `Esc` | Close dialog / palette | Dialog |

Shortcuts are defined in `keyboard/registry.ts` and wired via hooks in `keyboard/hooks.ts`.

## Command Palette

Opened with `Ctrl+K`, the command palette provides:
- **Navigation** — Jump to any page (Today, Inbox, Chats, Tasks, Memos, Settings)
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

Runtime detection for cross-platform behavior:

```typescript
IS_ELECTRON  // window.electronAPI exists
IS_CAPACITOR // window.Capacitor exists
IS_IOS / IS_ANDROID / IS_MOBILE
IS_WEB       // Not Electron, not Capacitor
detectPlatform(): 'web' | 'electron' | 'ios' | 'android'
```

On mobile (Capacitor), resizable panels are skipped and fixed layout is used instead.

## API Types

All API types are defined as Zod schemas in `types/schemas.ts` for runtime validation, with TypeScript types inferred via `z.infer<>` and re-exported from `types/api.ts`:

```typescript
TodoResponse    { id, title, description, status, priority, due_date, completed_at, tags, created_at, updated_at }
TodoCreate      { title, description?, priority?, due_date?, tags? }
EventResponse   { id, title, description, start_time, end_time, location, is_all_day, reminder_minutes, recurrence_rule, tags, created_at, updated_at }
ConversationResponse { id, title, last_message, is_archived?, created_at, updated_at }
MessageResponse { id, conversation_id, role, content, message_type?, created_at }
MemoResponse    { id, title, content, tags, created_at, updated_at }
AttachmentResponse { id, filename, stored_filename, content_type, size_bytes, memo_id, todo_id, url, created_at }
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
npm run dev:electron  # Electron + Vite
npm run typecheck     # npx tsc --noEmit
npm run build         # Production build
```

Demo mode activates automatically when no server URL is configured — all pages show seeded sample data.
