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
- [x] Local `in_progress` status with server sync (`pending`/`completed` on server)
- [x] Checkbox toggle moves tasks between Todo/Done, clears kanban overrides
- [x] Quick capture modal with natural language input (tasks, events, memos)
- [x] Responsive kanban: columns stack vertically below 768px
- [x] Task detail editing (title, priority, due date, tags, description)
- [x] Today dashboard with greeting, task sections, overdue items
- [x] Inbox page for unscheduled tasks
- [x] Demo data seeding (15 sample tasks across all columns)

### AI Chat
- [x] SSE streaming (Server-Sent Events) with real-time token rendering
- [x] Streaming indicator (animated 3-dot typing)
- [x] Stop generation (AbortController)
- [x] Message actions: copy, delete, edit, regenerate
- [x] User/assistant message bubbles with hover action menus
- [x] Conversation list with avatars and previews

### State Management (Zustand)
- [x] `useAuthStore` — JWT auth, server URL, token refresh, persisted
- [x] `useChatStore` — Conversations, messages, SSE streaming, abort
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

---

## In Progress

### Calendar & Events
- [ ] Event creation flow from UI
- [ ] Calendar view (week/month)
- [ ] Event reminders

### Backend Integration
- [ ] End-to-end server connection testing
- [ ] AI intent classification wiring
- [ ] Full CRUD sync for all modules

---

## Planned

### Phase 1: Server Integration
- [ ] Login page connected to FastAPI auth
- [ ] Live data replacing demo seeds
- [ ] Real-time chat with server LLM
- [ ] Push notifications via Electron tray

### Phase 2: AI Features
- [ ] Intent classifier (LLM function calling)
- [ ] Chat-to-action: create tasks/events from conversation
- [ ] Daily morning briefing generation
- [ ] Cross-module search (`/api/search`)
- [ ] Conversation context in AI prompts

### Phase 3: Mobile
- [ ] Capacitor builds for iOS and Android
- [ ] Bottom tab navigation for mobile layout
- [ ] Touch-optimized kanban (touch drag-and-drop)
- [ ] Push notifications (Capacitor)

### Phase 4: Polish & Deploy
- [ ] Offline support (queue actions, sync on reconnect)
- [ ] Electron auto-update
- [ ] Production Docker deployment docs
- [x] Keyboard shortcuts for navigation *(completed)*
- [ ] Performance optimization (virtualized lists)

---

## Future Considerations

- Google Calendar bidirectional sync
- Voice input (speech-to-text)
- Web dashboard for server admin
- Multi-language AI responses
- End-to-end encryption
- Plugin system for community modules
