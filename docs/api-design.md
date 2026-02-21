# API Design

All communication between the mobile app and the self-hosted server uses REST (HTTPS) for CRUD operations and WebSocket (WSS) for real-time streaming.

## Base URL

```
https://<server-address>:<port>/api
```

## Authentication

All endpoints (except `GET /api/health`) require a JWT bearer token.

### Login Flow

1. User enters their server URL and PIN/API key in the app
2. App sends `POST /api/auth/login` with the credentials
3. Server returns a JWT access token + refresh token
4. App includes `Authorization: Bearer <token>` on all subsequent requests

### Endpoints

```
POST /api/auth/login          # Authenticate and receive tokens
POST /api/auth/refresh        # Refresh an expired access token
POST /api/auth/logout         # Invalidate the current token
```

#### `POST /api/auth/login`

```json
// Request
{
  "pin": "123456"
}

// Response 200
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "token_type": "bearer",
  "expires_in": 3600
}
```

---

## Health Check

```
GET /api/health
```

Returns server status (no auth required).

```json
// Response 200
{
  "status": "ok",
  "version": "0.1.0",
  "ai_provider": "ollama",
  "ai_model": "llama3.2"
}
```

---

## Chat Endpoints

### Conversations

```
GET    /api/chat/conversations              # List all conversations (paginated)
POST   /api/chat/conversations              # Create a new conversation
GET    /api/chat/conversations/:id          # Get conversation with messages
DELETE /api/chat/conversations/:id          # Archive/delete a conversation
```

#### `GET /api/chat/conversations`

```json
// Query params: ?page=1&limit=20&archived=false

// Response 200
{
  "items": [
    {
      "id": "conv_abc123",
      "title": "Meeting planning",
      "updated_at": "2026-02-21T10:30:00Z",
      "last_message_preview": "I've scheduled the meeting for 3 PM.",
      "is_archived": false
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 20
}
```

### Messages

```
POST   /api/chat/send                       # Send a message (triggers AI processing)
GET    /api/chat/conversations/:id/messages  # Get messages for a conversation (paginated)
```

#### `POST /api/chat/send`

This is the primary endpoint. Sending a message triggers intent classification and returns an immediate acknowledgment. The AI response streams back via WebSocket.

```json
// Request
{
  "conversation_id": "conv_abc123",
  "content": "Schedule a meeting with Haechan tomorrow at 3 PM about VLA model review"
}

// Response 202 (Accepted — full response streams via WebSocket)
{
  "message_id": "msg_xyz789",
  "conversation_id": "conv_abc123",
  "status": "processing"
}
```

---

## Todo Endpoints

```
GET    /api/todos                  # List todos (filterable by status, priority, due date)
POST   /api/todos                  # Create a todo
GET    /api/todos/:id              # Get a specific todo
PATCH  /api/todos/:id              # Update a todo (status, title, etc.)
DELETE /api/todos/:id              # Delete a todo
```

#### `GET /api/todos`

```json
// Query params: ?status=pending&priority=high&due_before=2026-02-28&page=1&limit=20

// Response 200
{
  "items": [
    {
      "id": "todo_001",
      "title": "Review VLA paper",
      "status": "pending",
      "priority": "high",
      "due_date": "2026-02-25T23:59:00Z",
      "tags": ["research", "vla"],
      "created_at": "2026-02-21T09:00:00Z"
    }
  ],
  "total": 5,
  "page": 1,
  "limit": 20
}
```

#### `POST /api/todos`

```json
// Request
{
  "title": "Review VLA paper",
  "description": "Read and summarize key findings",
  "priority": "high",
  "due_date": "2026-02-25T23:59:00Z",
  "tags": ["research", "vla"]
}

// Response 201
{
  "id": "todo_001",
  "title": "Review VLA paper",
  "description": "Read and summarize key findings",
  "status": "pending",
  "priority": "high",
  "due_date": "2026-02-25T23:59:00Z",
  "tags": ["research", "vla"],
  "created_at": "2026-02-21T09:00:00Z",
  "updated_at": "2026-02-21T09:00:00Z"
}
```

---

## Calendar Endpoints

```
GET    /api/events                 # List events (filterable by date range)
POST   /api/events                 # Create an event
GET    /api/events/:id             # Get a specific event
PATCH  /api/events/:id             # Update an event
DELETE /api/events/:id             # Delete an event
```

#### `GET /api/events`

```json
// Query params: ?start_after=2026-02-21&start_before=2026-02-28&page=1&limit=50

// Response 200
{
  "items": [
    {
      "id": "evt_001",
      "title": "VLA Model Review with Haechan",
      "start_time": "2026-02-22T15:00:00Z",
      "end_time": "2026-02-22T16:00:00Z",
      "location": null,
      "is_all_day": false,
      "reminder_minutes": 15
    }
  ],
  "total": 3,
  "page": 1,
  "limit": 50
}
```

---

## Memo Endpoints

```
GET    /api/memos                  # List memos (paginated, sorted by updated_at)
POST   /api/memos                  # Create a memo
GET    /api/memos/:id              # Get a specific memo
PATCH  /api/memos/:id              # Update a memo
DELETE /api/memos/:id              # Delete a memo
```

---

## Search Endpoint

```
GET    /api/search                 # Full-text search across all data types
```

#### `GET /api/search`

```json
// Query params: ?q=VLA+model&types=todos,events,memos,messages&page=1&limit=20

// Response 200
{
  "items": [
    {
      "type": "todo",
      "id": "todo_001",
      "title": "Review VLA paper",
      "snippet": "Read and summarize key findings about **VLA model**...",
      "score": 0.95,
      "created_at": "2026-02-21T09:00:00Z"
    },
    {
      "type": "event",
      "id": "evt_001",
      "title": "VLA Model Review with Haechan",
      "snippet": "Meeting about **VLA model** review...",
      "score": 0.88,
      "created_at": "2026-02-21T10:30:00Z"
    }
  ],
  "total": 2,
  "page": 1,
  "limit": 20
}
```

---

## WebSocket Protocol

### Connection

```
wss://<server-address>:<port>/ws?token=<jwt_token>
```

The client opens a single persistent WebSocket connection after authentication. All real-time communication flows through this connection.

### Message Format

All WebSocket messages are JSON with a `type` field:

```json
{
  "type": "<message_type>",
  "data": { ... }
}
```

### Server -> Client Message Types

#### `stream_start`

Signals the beginning of a streaming AI response.

```json
{
  "type": "stream_start",
  "data": {
    "message_id": "msg_xyz789",
    "conversation_id": "conv_abc123"
  }
}
```

#### `stream_chunk`

A chunk of streaming text from the AI.

```json
{
  "type": "stream_chunk",
  "data": {
    "message_id": "msg_xyz789",
    "content": "I'll schedule",
    "index": 0
  }
}
```

#### `stream_end`

Signals the streaming response is complete.

```json
{
  "type": "stream_end",
  "data": {
    "message_id": "msg_xyz789",
    "full_content": "I'll schedule a meeting with Haechan tomorrow at 3 PM about VLA model review.",
    "intent": "create_event",
    "usage": {
      "prompt_tokens": 150,
      "completion_tokens": 45
    }
  }
}
```

#### `action_card`

An interactive UI card for confirming or displaying module actions.

```json
{
  "type": "action_card",
  "data": {
    "message_id": "msg_xyz789",
    "card_type": "event_created",
    "payload": {
      "id": "evt_001",
      "title": "VLA Model Review with Haechan",
      "start_time": "2026-02-22T15:00:00Z",
      "end_time": "2026-02-22T16:00:00Z"
    },
    "actions": [
      { "label": "Edit", "action": "edit_event", "params": { "id": "evt_001" } },
      { "label": "Delete", "action": "delete_event", "params": { "id": "evt_001" } }
    ]
  }
}
```

#### `notification`

Push notification for agent task completion, reminders, etc.

```json
{
  "type": "notification",
  "data": {
    "title": "Agent Task Complete",
    "body": "Your research summary on VLA models is ready.",
    "conversation_id": "conv_abc123",
    "action": "open_conversation"
  }
}
```

### Client -> Server Message Types

#### `action_response`

User responds to an action card.

```json
{
  "type": "action_response",
  "data": {
    "message_id": "msg_xyz789",
    "action": "edit_event",
    "params": { "id": "evt_001" }
  }
}
```

#### `typing`

User typing indicator (optional).

```json
{
  "type": "typing",
  "data": {
    "conversation_id": "conv_abc123",
    "is_typing": true
  }
}
```

---

## AI Intent Classification

When a user message is sent via `POST /api/chat/send`, the backend classifies the intent before routing to the appropriate handler.

### Supported Intents

| Intent | Description | Module |
|--------|-------------|--------|
| `general_chat` | General conversation, no specific action | AI Chat |
| `create_todo` | Create a new task | Todo Service |
| `query_todos` | List or search tasks | Todo Service |
| `update_todo` | Modify an existing task | Todo Service |
| `delete_todo` | Remove a task | Todo Service |
| `complete_todo` | Mark a task as done | Todo Service |
| `create_event` | Create a calendar event | Calendar Service |
| `query_events` | List or search events | Calendar Service |
| `update_event` | Modify an existing event | Calendar Service |
| `delete_event` | Remove an event | Calendar Service |
| `create_memo` | Create a note | Memo Service |
| `query_memos` | List or search notes | Memo Service |
| `update_memo` | Modify an existing note | Memo Service |
| `delete_memo` | Remove a note | Memo Service |
| `search` | Full-text search across all data | Search Service |
| `delegate_task` | Assign an async task to the AI agent | Agent Service |
| `daily_briefing` | Request today's summary | Briefing Service |

---

## Error Response Format

All errors follow a consistent format:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "due_date must be in the future",
    "details": {
      "field": "due_date",
      "value": "2026-01-01T00:00:00Z"
    }
  }
}
```

### Error Codes

| HTTP Status | Code | Description |
|-------------|------|-------------|
| 400 | `VALIDATION_ERROR` | Invalid request body or parameters |
| 401 | `UNAUTHORIZED` | Missing or invalid JWT token |
| 403 | `FORBIDDEN` | Token valid but insufficient permissions |
| 404 | `NOT_FOUND` | Resource does not exist |
| 409 | `CONFLICT` | Resource conflict (e.g., duplicate) |
| 422 | `UNPROCESSABLE` | Semantically invalid request |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Unexpected server error |
| 503 | `AI_UNAVAILABLE` | LLM provider is unreachable |
