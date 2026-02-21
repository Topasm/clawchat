# Architecture Overview

## System Diagram

```
┌─ React Native Mobile App (Expo) ─────────────────────┐
│                                                        │
│   Screens              State (Zustand)                 │
│   ├── ChatScreen       ├── useAuthStore                │
│   ├── AssistantScreen  ├── useChatStore                │
│   └── SettingsScreen   └── useModuleStore              │
│                                                        │
│   Components           Services                        │
│   ├── ActionCard       ├── apiClient (axios)           │
│   ├── StreamingText    └── wsManager (WebSocket)       │
│   ├── QuickActionBar                                   │
│   ├── ContactRow                                       │
│   └── Cell                                             │
│                                                        │
└────────────────────┬──────────────────────────────────┘
                     │ REST (HTTPS) + WebSocket (WSS)
                     │ User's own server only
┌────────────────────┼──────────────────────────────────┐
│  Self-Hosted Server │                                  │
│                     │                                  │
│  FastAPI Backend                                       │
│  ├── Routers (chat, todo, calendar, memo, search)      │
│  ├── Services (ai_service, ws_manager, scheduler)      │
│  ├── Agent (intent classifier + orchestrator)          │
│  └── Models & Schemas (SQLAlchemy + Pydantic)          │
│                                                        │
│  SQLite Database                                       │
│  ├── conversations, messages                           │
│  ├── todos, events, memos                              │
│  └── agent_tasks                                       │
│                                                        │
│  LLM Provider                                          │
│  └── Ollama (local) or OpenAI-compatible API (cloud)   │
└────────────────────────────────────────────────────────┘
```

## Design Principles

### 1. Self-Hosted & Privacy-First
All data stays on the user's server. The mobile app communicates only with this server over HTTPS. No telemetry, no analytics, no third-party data processing. When using a local LLM (Ollama), even AI inference stays on-premise.

### 2. Conversation as Interface
Natural language chat is the primary way users interact with all features. Users can create, query, update, and delete tasks, events, and notes through conversation. Direct manipulation UI (tapping, swiping) remains available but conversation is always a viable alternative.

### 3. Unified Data Model
Todos, calendar events, notes, and conversations live in a single SQLite database. This enables cross-module awareness (the AI knows your schedule when suggesting task priorities), full-text search across all data types, and traceability (every item links back to the conversation that created it).

### 4. Local by Default, Cloud by Choice
The system works fully offline with a local LLM. Cloud services (Claude API, Google Calendar sync) are optional enhancements configured through the settings screen.

## Component Overview

### Mobile App
- **Expo + React Native**: Cross-platform with native capabilities
- **React Navigation**: Tab-based layout (Chat, Assistant, Settings) with stack screens
- **Zustand**: Lightweight state management replacing React Context
- **react-native-gifted-chat**: Chat UI with custom rendering for AI features
- **Axios + WebSocket**: Communication with the self-hosted server

### Backend Server
- **FastAPI**: Async Python framework handling REST and WebSocket connections
- **SQLAlchemy**: ORM for database operations
- **Alembic**: Database migration management
- **Pydantic**: Request/response validation and serialization

### AI Layer
- **Intent Classifier**: Determines what the user wants (create_todo, query_calendar, general_chat, etc.)
- **Orchestrator**: Routes classified intents to the appropriate module service
- **AI Service**: Manages streaming completions from the LLM provider
- **Scheduler**: Runs periodic tasks (morning briefings, reminders, auto-tasks)

## Data Flow

```
User sends message
    │
    ▼
Mobile App ──POST /api/chat──► FastAPI Router
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
              Return result   via WebSocket    Notify later
                    │               │
                    ▼               ▼
              Action Card      Streaming text
              via WebSocket    in chat bubble
                    │               │
                    └───────┬───────┘
                            ▼
                    Mobile App renders
                    response in chat
```

1. **User sends a message** via the chat input
2. **App sends POST** to `/api/chat/send` with the message text and conversation ID
3. **Intent Classifier** analyzes the message using an LLM function-calling prompt to determine the intent (e.g., `create_todo`, `query_calendar`, `general_chat`)
4. **Orchestrator** routes to the appropriate handler:
   - **Module services** execute CRUD operations and return structured results
   - **General chat** streams AI-generated text back via WebSocket
   - **Agent tasks** are queued for async execution with notification on completion
5. **WebSocket delivers** real-time responses: streaming text chunks, action cards (interactive UI for confirming todo creation, showing calendar events, etc.), and status updates
6. **Mobile app renders** the response in the chat interface

## Reference Project Comparison

The architecture borrows navigation and UI patterns from the [react-native-chat](https://github.com/Ctere1/react-native-chat) reference project, adapting them for a self-hosted AI assistant context.

| Aspect | Reference (react-native-chat) | ClawChat |
|--------|-------------------------------|----------|
| Backend | Firebase (Auth + Firestore + Storage) | Self-hosted FastAPI + SQLite |
| Real-time | Firestore `onSnapshot` listeners | WebSocket connections |
| Auth | Firebase Auth (email/password) | JWT token (server URL + PIN/API key) |
| State | React Context (`AuthenticatedUserContext`, `UnreadMessagesContext`) | Zustand stores (`useAuthStore`, `useChatStore`) |
| Chat UI | react-native-gifted-chat | react-native-gifted-chat (extended with streaming + action cards) |
| Navigation | Stack + Bottom Tabs (Chats, Settings) | Stack + Bottom Tabs (Chat, Assistant, Settings) |
| Data model | Firestore documents | SQLite tables via SQLAlchemy |
| Components | ContactRow, Cell, ChatHeader, ChatMenu | ContactRow, Cell (reused) + ActionCard, StreamingText, QuickActionBar (new) |
