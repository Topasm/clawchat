# Development Roadmap

A phased plan for building ClawChat from zero to a deployable AI secretary.

---

## Phase 1: Foundation (Weeks 1-2)

Establish the core infrastructure for both server and mobile app.

### Server

- [ ] Initialize FastAPI project with directory structure
- [ ] Set up SQLAlchemy + Alembic with initial migration (all tables)
- [ ] Implement auth endpoints (`/api/auth/login`, `/api/auth/refresh`)
- [ ] Implement JWT middleware and auth dependencies
- [ ] Build CRUD routers: todos, events, memos
- [ ] Add pagination and filtering to list endpoints
- [ ] Implement health check endpoint
- [ ] Set up configuration from environment variables
- [ ] Write Dockerfile and docker-compose.yml

### Mobile App

- [ ] Initialize Expo project
- [x] Set up React Navigation (stack + bottom tabs)
- [ ] Implement LoginScreen (server URL + PIN)
- [x] Create Zustand stores: `useAuthStore`, `useChatStore`, `useModuleStore`
- [ ] Build API client (Axios with auth interceptor)
- [ ] Implement ConversationListScreen (list conversations from API)
- [ ] Implement basic ChatScreen with GiftedChat (send/receive messages via REST)
- [ ] Port ContactRow and Cell components from reference project
- [x] Set up theme system (`config/theme.js`)

### Milestone
A user can log in, send a message, and receive a (non-AI) echo response. CRUD operations work for todos, events, and memos via the REST API.

---

## Phase 2: AI Integration (Weeks 3-4)

Add the AI engine and real-time streaming.

### Server

- [ ] Implement `AIService` wrapping OpenAI-compatible API (Ollama / cloud)
- [ ] Implement intent classifier using LLM function calling
- [ ] Build orchestrator to route intents to module services
- [x] Implement SSE streaming endpoint (`POST /api/chat/stream`)
- [x] Wire up streaming: chat message -> stream response via SSE
- [x] Add action card generation for module actions (todo created, event scheduled)
- [ ] Store classified intents and metadata in messages table
- [ ] Add docker-compose.ollama.yml with Ollama service
- [x] Add message CRUD endpoints (DELETE, PUT for edit)

### Mobile App

- [x] Implement SSE client (`services/sseClient.js`) using fetch + ReadableStream
- [x] Handle streaming tokens in ChatScreen with real-time rendering
- [x] Build MarkdownBubble component for markdown/code block rendering
- [x] Build ActionCard component for interactive AI responses
- [x] Update `useChatStore` with `sendMessageStreaming` and `appendToLastMessage`
- [x] Add TypingIndicator during AI processing (before first token)
- [x] Add stop generation button (AbortController)
- [ ] Test end-to-end: user message -> intent classification -> streamed response

### Milestone
A user can have a natural language conversation with the AI. The AI classifies intents and executes actions (creating todos, scheduling events) with results streamed back in real time.

---

## Phase 3: Assistant Features (Weeks 5-7)

Build out the full assistant functionality.

### Server

- [ ] Complete all intent handlers in orchestrator (CRUD for all modules)
- [ ] Implement full-text search service (SQLite FTS5)
- [ ] Build agent service for async tasks (research, summarization)
- [ ] Add scheduler for daily briefing generation
- [ ] Add scheduler for reminder checks and push notifications
- [ ] Implement `/api/search` endpoint
- [ ] Add conversation context to AI prompts (recent messages for continuity)
- [ ] Handle multi-turn conversations (e.g., "edit the last todo I created")

### Mobile App

- [x] Build Today dashboard with task/event sections (replaced AssistantScreen)
- [x] Implement QuickActionBar above chat input
- [x] Build SettingsScreen (server info, AI model selection, briefing time, logout)
- [ ] Handle `notification` WebSocket messages
- [ ] Implement search UI (cross-module search results)
- [ ] Add pull-to-refresh on conversation list and module views
- [x] Handle action card interactions (edit, delete, complete)

### Milestone
The app functions as a full personal assistant. Users can manage all data through conversation or direct UI, search across all modules, receive daily briefings, and delegate async tasks.

---

## Phase 4: Polish & Deploy (Weeks 8-9)

Harden, optimize, and prepare for real usage.

### Server

- [ ] Add rate limiting middleware
- [ ] Add request logging and structured error handling
- [ ] Optimize database queries with proper indexes
- [ ] Add database backup script
- [ ] Write production Caddyfile for HTTPS
- [ ] Test Docker deployment on fresh machine
- [ ] Document all environment variables in `.env.example`

### Mobile App

- [ ] Add offline support (queue messages when disconnected, sync on reconnect)
- [ ] Add push notification handling (expo-notifications)
- [ ] Implement conversation archiving and deletion
- [ ] Add loading states, error states, and empty states for all screens
- [ ] UI polish: animations, transitions, haptic feedback
- [ ] Test on both iOS and Android devices
- [ ] Build APK for sideloading, configure TestFlight for iOS

### Documentation

- [ ] Finalize all docs in `docs/` folder
- [ ] Write troubleshooting guide
- [ ] Add architecture diagrams
- [ ] Create video walkthrough of setup process

### Milestone
ClawChat is deployable with `docker compose up`. A user can install the server, connect the app, and use it as a daily personal assistant. All core features work reliably.

---

## UI/UX Redesign (Completed)

Things 3-inspired GTD experience integrated with AI chat.

### Completed
- [x] 4-tab layout: Today, Inbox, (+) FAB, Chat, Settings
- [x] Custom tab bar with center "+" quick capture button
- [x] Today dashboard (greeting, events, tasks, overdue, inbox count)
- [x] Inbox screen for unscheduled tasks with swipe gestures
- [x] Task detail editing (priority, due date, description, delete)
- [x] Event detail editing (time, location, all-day toggle, delete)
- [x] All tasks grouped view (in progress, pending, completed)
- [x] Quick capture modal with natural language parsing
- [x] Chat smart send (auto-detect tasks/events from keywords)
- [x] Action cards in chat (task/event created confirmations)
- [x] Quick action bar chips above chat input
- [x] Natural language parser (dates, times, types, priorities)
- [x] Backend /api/today consolidated endpoint
- [x] APScheduler reminder and overdue task checker
- [x] Push notification token registration endpoint
- [x] Android home screen widget (react-native-android-widget)
- [x] Things 3 color palette (todayBlue, inboxYellow, completedGreen, overdueRed)
- [x] Shared components: TaskRow, EventRow, SectionHeader, PriorityBadge, EmptyState
- [x] Store async actions (fetchTodos, fetchEvents, toggleTodoComplete, createTodo, createEvent)
- [x] Date utility functions (isToday, isTomorrow, isOverdue, formatDueDate, getGreeting, groupTodosByDate)

---

## Chat Enhancements (Completed)

Nekogram-inspired feature improvements for the chat experience.

### Completed
- [x] **Markdown/Code Rendering**: MarkdownBubble component with syntax-highlighted code blocks, copy-to-clipboard, language labels (react-native-markdown-display)
- [x] **SSE Streaming**: Real-time token streaming via `POST /api/chat/stream` with SSE, replacing polling/echo approach; sseClient.js using fetch + ReadableStream; AbortController for stop generation
- [x] **Comprehensive Settings**: 15+ configurable options across 7 sections (Chat, LLM, Appearance, Notifications, Data, About, Account); useSettingsStore with AsyncStorage persistence; SystemPromptScreen for custom prompts; import/export settings as JSON
- [x] **Dark Mode & Theme System**: ThemeContext + ThemeProvider with light/dark/system modes; OLED-friendly pure black dark theme; iOS-bright accent colors; all 10 screens + 11 components updated; StatusBar management; AsyncStorage theme persistence
- [x] **Message Interactions**: Long-press context menu (MessageActionMenu) with copy, edit & resend, regenerate, delete; MessageBubbleWrapper with haptic feedback (expo-haptics); CopyFeedback toast; optimistic local updates with server sync
- [x] **Custom Settings Components**: 8 reusable cell components (SettingsToggleCell, SettingsSliderCell, SettingsNavigationCell, SettingsButtonCell, SettingsDetailCell, SettingsSegmentedCell, SettingsSectionHeader, CustomSlider)
- [x] **Backend Message CRUD**: DELETE and PUT endpoints for individual messages in conversations

---

## Future Considerations (Post v1.0)

These are explicitly **not** in the initial scope but worth tracking:

- **~~Home screen widgets~~** — Android widget implemented via react-native-android-widget; iOS WidgetKit pending
- **Google Calendar sync** (bidirectional via Google Calendar API)
- **Voice input** (speech-to-text for hands-free interaction)
- **Web dashboard** (admin panel for server management)
- **Multi-language AI responses** (Korean, English, etc.)
- **End-to-end encryption** (if threat model changes)
- **Plugin system** for community-built modules
