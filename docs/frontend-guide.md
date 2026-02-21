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
│   │   ├── platform.ts               # Platform detection (Electron, Capacitor, Web)
│   │   └── electron.d.ts             # Electron API type declarations
│   ├── stores/
│   │   ├── useAuthStore.ts           # Auth state: JWT, serverUrl, login/logout (persisted)
│   │   ├── useChatStore.ts           # Chat: conversations, messages, SSE streaming
│   │   ├── useModuleStore.ts         # Modules: todos, events, memos, kanban statuses
│   │   └── useSettingsStore.ts       # Settings: theme, LLM, chat, notifications (persisted)
│   ├── pages/
│   │   ├── TodayPage.tsx             # Dashboard: greeting, tasks, events, inbox count
│   │   ├── InboxPage.tsx             # Unscheduled tasks (GTD inbox)
│   │   ├── ChatListPage.tsx          # Conversation history list
│   │   ├── ChatPage.tsx              # Full-screen AI conversation
│   │   ├── AllTasksPage.tsx          # Kanban board (renders KanbanBoard)
│   │   ├── TaskDetailPage.tsx        # Task editing (title, priority, due date, tags)
│   │   ├── EventDetailPage.tsx       # Event editing (time, location)
│   │   ├── SettingsPage.tsx          # All settings (7 sections)
│   │   └── SystemPromptPage.tsx      # LLM system prompt editor
│   ├── components/
│   │   ├── Layout.tsx                # Sidebar navigation + main content area + chat panel
│   │   ├── kanban/
│   │   │   ├── KanbanBoard.tsx       # Board orchestrator: groups todos, renders 3 columns
│   │   │   ├── KanbanColumn.tsx      # Drop target: drag-over highlight, header, card list
│   │   │   └── KanbanCard.tsx        # Draggable wrapper: HTML5 drag events + TaskCard
│   │   ├── chat-panel/
│   │   │   ├── ChatPanel.tsx         # Collapsible bottom chat panel
│   │   │   ├── ChatInput.tsx         # Textarea + send/stop buttons
│   │   │   ├── ChatPanelMessages.tsx # Message list (column-reverse)
│   │   │   ├── MessageBubble.tsx     # User/assistant bubble with actions
│   │   │   └── StreamingIndicator.tsx # Animated 3-dot typing indicator
│   │   └── shared/
│   │       ├── TaskCard.tsx          # Task row: checkbox + title + badge meta
│   │       ├── Badge.tsx             # Pill badge: priority, due, tag, status, count
│   │       ├── Checkbox.tsx          # Circular animated checkbox
│   │       ├── SectionHeader.tsx     # Collapsible section with chevron + count
│   │       ├── EmptyState.tsx        # Icon + message placeholder
│   │       ├── EventCard.tsx         # Event display with time + location
│   │       ├── ConversationItem.tsx  # Chat list row with avatar + preview
│   │       ├── SegmentedControl.tsx  # Multi-option toggle
│   │       ├── Toggle.tsx            # On/off switch
│   │       ├── Slider.tsx            # Range input with value display
│   │       ├── SettingsRow.tsx       # Label + control settings row
│   │       └── SettingsSection.tsx   # Settings group container
│   ├── hooks/
│   │   └── useTodayData.ts          # Today dashboard data aggregation
│   ├── services/
│   │   └── apiClient.ts             # Axios with auth interceptor + token refresh
│   ├── config/
│   │   └── colors.ts                # Color palette object (light + dark)
│   └── utils/
│       └── formatters.ts            # Date/time helpers, grouping, greeting
├── styles/
│   ├── index.css                     # Main entry: imports all partials
│   ├── _reset.css                    # Box-sizing, scrollbar, font smoothing
│   ├── _variables.css                # .cc-root base styles
│   ├── _layout.css                   # Sidebar (220px), main area, content
│   ├── _components.css               # Cards, badges, checkbox, sections, buttons
│   ├── _chat.css                     # Bubbles, chat panel, input, streaming dots
│   ├── _kanban.css                   # 3-column grid, columns, drag states, responsive
│   ├── _pages.css                    # Page headers, detail pages, chat page
│   ├── _settings.css                 # Toggle, slider, segmented control, settings rows
│   ├── _utilities.css                # Margin, flex, gap helpers
│   └── _capacitor.css                # Mobile-specific overrides
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
/settings      → SettingsPage
/settings/system-prompt → SystemPromptPage
```

All routes are wrapped in `<Layout />` which provides the sidebar and persistent chat panel.

## State Management

### useModuleStore

Manages todos, events, memos, and kanban board state:

```typescript
// Key state
todos: TodoResponse[]              // Seeded with 15 demo tasks
kanbanStatuses: Record<string, KanbanStatus>  // Local in_progress overrides
events: EventResponse[]
memos: MemoResponse[]

// Key actions
setKanbanStatus(id, status)        // Move task between kanban columns
toggleTodoComplete(id)             // Toggle + clear kanban override
fetchTodos(params)                 // GET /todos (skips if no server configured)
```

The kanban board uses a **local override pattern**: the server only knows `pending` and `completed` statuses. The `in_progress` status is tracked client-side in `kanbanStatuses`. When a task is moved to "In Progress", its server status remains `pending` but the UI shows it in the correct column.

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

15+ persisted settings across: chat behavior, LLM parameters, appearance (theme), notifications, and privacy.

## Kanban Board

The All Tasks page (`/tasks`) renders a 3-column kanban board:

| Column | Status | Color |
|--------|--------|-------|
| Todo | `pending` | Blue highlight on drag-over |
| In Progress | `in_progress` | Yellow highlight on drag-over |
| Done | `completed` | Green highlight on drag-over |

**Drag and drop**: Uses HTML5 Drag and Drop API (no external dependencies).
- `KanbanCard` sets `dataTransfer` with the task ID on `dragStart`
- `KanbanColumn` handles `dragOver`/`drop` events and calls `setKanbanStatus`
- Visual feedback: dragging card gets `opacity: 0.4`, target column gets a colored border glow
- Checkbox toggle moves task between Todo/Done and clears any kanban override

**Responsive**: Columns stack vertically below 768px viewport width.

## CSS Architecture

All classes use BEM naming with `.cc-` prefix:

```
.cc-kanban                    → Board grid
.cc-kanban__column            → Column container
.cc-kanban__column--todo      → Todo variant
.cc-kanban__column--drag-over → Active drop target
.cc-kanban__header            → Column header
.cc-kanban__card              → Draggable card wrapper
.cc-kanban__card--dragging    → Reduced opacity while dragging
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

## API Types

All API interfaces mirror the server's Pydantic schemas:

```typescript
TodoResponse    { id, title, description, status, priority, due_date, tags, created_at, updated_at }
TodoCreate      { title, description?, priority?, due_date?, tags? }
TodoUpdate      { title?, description?, status?, priority?, due_date?, tags? }
KanbanStatus    = 'pending' | 'in_progress' | 'completed'  // Client-side extension

EventResponse   { id, title, description, start_time, end_time, location, created_at, updated_at }
ConversationResponse { id, title, last_message, created_at, updated_at }
MessageResponse { id, conversation_id, role, content, created_at }
TodayResponse   { today_tasks, overdue_tasks, today_events, inbox_count, greeting, date }
```

## Development

```bash
npm run dev           # Vite dev server (web)
npm run dev:electron  # Electron + Vite
npm run typecheck     # npx tsc --noEmit
npm run build         # Production build
```

Demo mode activates automatically when no server URL is configured — all pages show seeded sample data.
