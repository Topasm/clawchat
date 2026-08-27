# API Design

Clients use REST (HTTPS) for CRUD, SSE (Server-Sent Events) for streamed AI responses, and WebSocket notifications for cross-client synchronization.

This document is a usage guide, not the machine-readable source of truth. FastAPI's deterministic snapshot at `server/openapi.json` is authoritative for request/response schemas. After changing a Pydantic schema or route contract, run:

```bash
npm run generate:api        # refresh OpenAPI and generated TypeScript/Kotlin contracts
uv run --project server --locked python scripts/export-openapi.py --check
npm run check:api-contract  # verify generated TS/Kotlin values against the snapshot
```

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
POST   /api/chat/send                                          # Send a message (echo mode fallback)
POST   /api/chat/stream                                        # Send a message with SSE streaming response
GET    /api/chat/conversations/:id/messages                    # Get messages for a conversation (paginated)
DELETE /api/chat/conversations/:id/messages/:message_id        # Delete a specific message
PUT    /api/chat/conversations/:id/messages/:message_id        # Edit a message's content
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
  "status": "delivered"
}
```

#### `POST /api/chat/stream`

Primary endpoint for chat. Sends a message and streams the AI response via Server-Sent Events.

```json
// Request
{
  "conversation_id": "conv_abc123",
  "content": "Explain the difference between SSE and WebSocket"
}

// Response: text/event-stream
// Event 1 — metadata:
data: {"conversation_id": "conv_abc123", "message_id": "msg_xyz789"}

// Event 2..N — tokens:
data: {"token": "SSE"}
data: {"token": " is"}
data: {"token": " a"}
data: {"token": " simpler"}

// Final event:
data: [DONE]
```

The frontend uses `fetch()` with a `ReadableStream` reader to consume tokens in real time. An `AbortController` allows the user to stop generation mid-stream.

#### `DELETE /api/chat/conversations/:id/messages/:message_id`

Delete a specific message. Returns `{"detail": "Message deleted"}`.

#### `PUT /api/chat/conversations/:id/messages/:message_id`

Edit a message's content. Returns the updated `MessageResponse`.

```json
// Request
{
  "content": "Updated message text"
}
```

---

## Todo Endpoints

```
GET    /api/todos                  # List todos (filterable by status, priority, due date)
GET    /api/todos/execution-telemetry # Sparse Task-level Run, Review, and Artifact projection
POST   /api/todos                  # Create a todo
PATCH  /api/todos/bulk             # Update or delete multiple todos
GET    /api/todos/:id              # Get a specific todo
PATCH  /api/todos/:id              # Update a todo (status, title, etc.)
DELETE /api/todos/:id              # Delete a todo
```

`GET /api/todos/execution-telemetry` accepts an optional `project_id` and
returns only Tasks that have a linked Run, pending Review, or Artifact. It is a
derived read model: Task ownership is resolved from the current Todo row, and
no telemetry value is persisted back onto the Todo.

`status` is the server-owned task lifecycle enum:

```text
pending | in_progress | completed | cancelled
```

`blocked` is not a status. Clients derive readiness from incomplete normalized
`depends_on` edges. The legacy nullable `depends_on: string[]` Todo field is
still accepted and returned during the compatibility window, but new clients
must use the task-relationship endpoints below.

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

#### `PATCH /api/todos/bulk`

```json
// Request: set an exact canonical status
{
  "ids": ["todo_001", "todo_002"],
  "status": "in_progress"
}

// Response 200
{
  "updated": 2,
  "deleted": 0,
  "errors": []
}
```

## Task Relationship Endpoints

```text
GET    /api/task-relationships       # List/filter normalized task links
POST   /api/task-relationships       # Create and validate one link
POST   /api/task-relationships/commands/dependency/preview # Validate and preview impact
POST   /api/task-relationships/commands/dependency         # Revision-safe dependency apply
PATCH  /api/task-relationships/:id   # Change endpoints, type, or label
DELETE /api/task-relationships/:id   # Delete one link
```

`GET` accepts `task_id`, `source_task_id`, `target_task_id`, `type`, and
`limit`. `task_id` matches either endpoint. For `depends_on`, the source is the
task being executed and the target is its prerequisite:

```json
// POST /api/task-relationships
{
  "source_task_id": "todo_analysis",
  "target_task_id": "todo_experiment",
  "type": "depends_on"
}

// Response 201
{
  "id": "rel_3f04c7b8c1a2",
  "source_task_id": "todo_analysis",
  "target_task_id": "todo_experiment",
  "type": "depends_on",
  "label": null,
  "created_by": "user",
  "proposal_id": null,
  "created_at": "2026-08-27T09:00:00Z",
  "updated_at": "2026-08-27T09:00:00Z"
}
```

The server rejects missing endpoints, self-links, duplicate typed edges, and a
`depends_on` mutation that would introduce a cycle. Deleting a Todo cascades to
all incident relationships. The inverse `blocks` direction is derived rather
than persisted. `created_by` and `proposal_id` are server-owned provenance and
cannot be supplied or changed through the public relationship mutation API.
Malformed or invalid graphs return the named `ErrorResponse` contract with
HTTP 400, an existing/conflicting edge returns 409, and request-schema failures
return 422.

Inbox connectors use semantic endpoint names and an optimistic-concurrency
revision. Preview performs the same relationship validation as apply but rolls
back its savepoint, so neither the edge, compatibility shadow, nor graph
revision changes:

```json
{
  "dependent_task_id": "todo_figure",
  "prerequisite_task_id": "todo_ablation",
  "expected_graph_revision": 32
}
```

The preview response includes `base_graph_revision`, `affected_task_ids`, and
Ready/Blocked/critical-path deltas. Apply additionally returns the persisted
relationship and new `graph_revision`. Cycle errors include
`details.cycle_task_ids`; stale revisions return HTTP 409 with expected and
current revisions.

## Execution Graph Insights

```text
GET /api/todos/graph/insights?root_task_id=:root_id&limit=2000
```

Omit `root_task_id` for a global snapshot. A root-scoped response includes the
root, all structural descendants, and the recursive prerequisite closure.
Prerequisites outside the root are returned as `scope_role: "context"`; summary
lifecycle/Ready/Blocked/risk counts cover only the primary root scope, while
critical-path and health diagnostics include relevant context.

```json
{
  "graph_revision": 21,
  "generated_at": "2026-08-27T07:00:00Z",
  "scope": {
    "root_task_id": "todo_project",
    "task_count": 7,
    "primary_task_count": 6,
    "relationship_count": 5,
    "prerequisite_task_count": 1
  },
  "nodes": [
    {
      "task_id": "todo_analysis",
      "scope_role": "descendant",
      "execution_state": "blocked",
      "is_ready": false,
      "is_blocked": true,
      "direct_blocker_ids": ["todo_experiment"],
      "transitive_blocker_ids": ["todo_data"],
      "downstream_count": 2,
      "is_on_critical_path": true,
      "remaining_path_minutes": 420,
      "remaining_path_known_minutes": 420,
      "estimate_complete": true,
      "due_risk": "insufficient_time"
    }
  ],
  "summary": {
    "ready_count": 2,
    "blocked_count": 3,
    "critical_path_task_ids": ["todo_data", "todo_experiment", "todo_analysis"],
    "critical_path_minutes": 420,
    "critical_path_estimate_complete": true,
    "at_risk_count": 1,
    "issue_count": 0,
    "is_healthy": true
  },
  "issues": [],
  "issues_truncated": false
}
```

Only `completed` prerequisites release a dependent; a cancelled prerequisite
remains a blocker. `ready` applies to pending actionable leaf tasks, while
`in_progress` remains separate. Null or invalid estimates are not treated as
zero: exact critical-path and deadline values become nullable and the response
retains a known lower bound. Deadline risk is a continuous wall-clock lower
bound, not a work-hours or resource scheduler.

Transitive blocker and downstream ID lists are capped at 20 items per node. If
the corresponding `*_truncated` flag is true, its count is a lower bound (for
example, `21` means at least 21) and clients must not present it as an exact
total. Oversized scopes fail with HTTP 400 rather than returning partial graph
semantics.

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

## Attachment Endpoints

```
POST   /api/attachments                    # Upload a file (multipart/form-data)
GET    /api/attachments                    # List attachments (filter by todo_id)
GET    /api/attachments/:id/download       # Download an attachment file
DELETE /api/attachments/:id                # Delete an attachment (removes file + DB row)
```

#### `POST /api/attachments`

Upload a file attachment linked to a todo.

```
Content-Type: multipart/form-data
Query params: ?todo_id=todo_xyz789
Body: file (binary)
```

```json
// Response 201
{
  "id": "att_abc123",
  "filename": "screenshot.png",
  "stored_filename": "a1b2c3d4e5f6.png",
  "content_type": "image/png",
  "size_bytes": 102400,
  "todo_id": "todo_xyz789",
  "url": "/api/attachments/att_abc123/download",
  "created_at": "2026-02-22T12:00:00Z"
}
```

**Validation:**

- Allowed extensions: `jpg, jpeg, png, gif, webp, svg, pdf, txt, md, zip` (configurable)
- Max file size: 10 MB (configurable via `MAX_UPLOAD_SIZE_MB`)
- Files stored on disk as `{uuid}.{ext}` in the configured `upload_dir`

#### `GET /api/attachments`

```json
// Query params: ?todo_id=todo_xyz789

// Response 200
[
  {
    "id": "att_abc123",
    "filename": "screenshot.png",
    "stored_filename": "a1b2c3d4e5f6.png",
    "content_type": "image/png",
    "size_bytes": 102400,
    "todo_id": "todo_xyz789",
    "url": "/api/attachments/att_abc123/download",
    "created_at": "2026-02-22T12:00:00Z"
  }
]
```

#### `DELETE /api/attachments/:id`

Deletes the attachment file from disk and the DB row. Returns `204 No Content`.

**Cascade behavior:** Deleting a todo automatically deletes all associated attachment DB rows (via `ON DELETE CASCADE`). Orphaned files on disk are cleaned up by the delete endpoint.

---

## Today Dashboard Endpoint

```
GET    /api/today                   # Consolidated today view (tasks, events, overdue, inbox count)
```

#### `GET /api/today`

Returns all data needed for the Today dashboard in a single request.

```json
// Response 200
{
  "today_tasks": [
    {
      "id": "todo_001",
      "title": "Review VLA paper",
      "status": "pending",
      "priority": "high",
      "due_date": "2026-02-21T23:59:00Z",
      "tags": ["research"],
      "created_at": "2026-02-21T09:00:00Z",
      "updated_at": "2026-02-21T09:00:00Z"
    }
  ],
  "overdue_tasks": [],
  "today_events": [
    {
      "id": "evt_001",
      "title": "VLA Model Review",
      "start_time": "2026-02-21T15:00:00Z",
      "end_time": "2026-02-21T16:00:00Z",
      "is_all_day": false
    }
  ],
  "inbox_count": 3,
  "greeting": "Good morning",
  "date": "2026-02-21"
}
```

---

## Notification Endpoints

```
POST   /api/notifications/register-token   # Register a platform push token
```

#### `POST /api/notifications/register-token`

```json
// Request
{
  "token": "<platform-push-token>",
  "device_id": "optional-device-id"
}

// Response 200
{
  "status": "registered"
}
```

---

## Search Endpoint

```
GET    /api/search                 # Full-text search across all data types
```

#### `GET /api/search`

```json
// Query params: ?q=VLA+model&types=todos,events,messages&page=1&limit=20

// Response 200
{
  "items": [
    {
      "type": "todo",
      "id": "todo_001",
      "title": "Review VLA paper",
      "preview": "Read and summarize key findings about VLA model...",
      "rank": -0.95,
      "created_at": "2026-02-21T09:00:00Z"
    },
    {
      "type": "event",
      "id": "evt_001",
      "title": "VLA Model Review with Haechan",
      "preview": "Meeting about VLA model review...",
      "rank": -0.88,
      "created_at": "2026-02-21T10:30:00Z"
    }
  ],
  "total": 2,
  "page": 1,
  "limit": 20
}
```

---

## WebSocket Synchronization Protocol

`POST /api/chat/stream` over SSE is the primary chat-streaming path. The persistent WebSocket remains active for cache invalidation, background-task progress, reminders, briefings, liveness, and compatibility with the asynchronous `/api/chat/send` path.

### Connection

```text
POST /api/auth/ws-ticket                    # Authorization: Bearer <access token>
wss://<server-address>:<port>/ws?ticket=<short-lived-ticket>
```

The client exchanges its bearer token for a short-lived ticket before opening the socket. A legacy `?token=` parameter is accepted only during the mobile migration window. On reconnect, clients refetch authoritative REST state so missed ephemeral events cannot create permanent drift.

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

#### `module_data_changed`

Tells clients to invalidate cached module data and refetch it from REST.

```json
{
  "type": "module_data_changed",
  "data": {
    "module": "todos"
  }
}
```

#### Background and notification events

Current clients also handle `task_completed`, `task_failed`, `task_progress`, `reminder`, `nudge`, `daily_briefing`, `weekly_review`, and `conversation_updated`. Liveness messages use `heartbeat`, `tick`, and `pong`.

### Client -> Server Message Types

#### `ping`

The client periodically sends a liveness probe; the server responds with `pong`.

```json
{
  "type": "ping"
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

## Admin Endpoints

Server management and monitoring endpoints. All require JWT authentication.

```
GET    /api/admin/overview                    # Server stats, table counts, storage
GET    /api/admin/ai                          # AI config + available models
POST   /api/admin/ai/test                     # Test AI connectivity + measure latency
GET    /api/admin/activity                    # Recent activity feed + agent task history
GET    /api/admin/sessions                    # Active WebSocket connections
POST   /api/admin/sessions/:user_id/disconnect  # Force-close a WebSocket connection
GET    /api/admin/config                      # Read-only server config from .env
GET    /api/admin/data                        # Per-module data overview (counts + date ranges)
POST   /api/admin/db/reindex                  # Trigger FTS5 reindex
POST   /api/admin/db/backup                   # Create timestamped DB backup
POST   /api/admin/db/purge                    # Purge old data (conversations, messages, completed todos)
```

#### `GET /api/admin/overview`

```json
// Response 200
{
  "server": {
    "uptime_seconds": 3600.5,
    "version": "0.1.0",
    "ai_provider": "ollama",
    "ai_model": "llama3.2",
    "ai_base_url": "http://localhost:11434",
    "ai_connected": true,
    "active_ws_connections": 1,
    "scheduler_enabled": false,
    "scheduler_running": false
  },
  "counts": {
    "conversations": 12,
    "messages": 150,
    "todos": 25,
    "events": 8,
    "agent_tasks": 3,
    "attachments": 2
  },
  "storage": {
    "db_size_bytes": 524288,
    "upload_dir_size_bytes": 102400,
    "attachment_count": 2,
    "attachment_total_bytes": 98304
  }
}
```

#### `POST /api/admin/db/purge`

```json
// Request
{
  "target": "conversations",
  "older_than_days": 90
}

// Response 200
{
  "deleted_count": 5,
  "target": "conversations"
}
```

Valid targets: `conversations`, `messages`, `todos` (only completed todos are purged).

---

## Todo Task Management Endpoints

### Organize (Inbox Pipeline)

```
POST   /api/todos/:id/organize              # Trigger inbox classification + persona suggestion
```

Runs the inbox pipeline as a background task. Classifies the todo and suggests an assignee persona.

```json
// Response 200
{
  "status": "processing",
  "todo_id": "todo_001"
}
```

### Place in Project Tree

```text
POST /api/todos/:id/placement
POST /api/todos/placements/batch
POST /api/todos/placements/triage-preview
POST /api/todos/placements/groups
POST /api/todos/placements/:change_set_id/undo
```

Placement moves the existing Task; it never creates a copy. Project-root drops,
parent drops, and sibling insertion are one atomic command guarded by the task
graph revision.

Batch placement accepts one to 100 unique Task IDs and uses their request order
at the destination:

```json
{
  "todo_ids": ["todo_variable_order", "todo_baseline", "todo_ablation"],
  "project_id": "project_paper",
  "parent_id": "todo_experiments",
  "before_id": null,
  "inbox_state": "none",
  "expected_graph_revision": 35
}
```

It returns `todos` rather than `todo` and one shared `change_set_id`. Overlapping
ancestor/descendant selections and any invalid member reject the whole command;
the existing Undo endpoint restores the entire batch.

AI triage preview is read-only and accepts selected Inbox Task IDs plus the
current graph revision. It returns only validated existing Project/parent
destinations, a confidence and explanation, and the IDs it could not place.
The server rejects unknown IDs, duplicate Task suggestions, cross-Project
parents, malformed model output, and revisions that change during generation.

Selected recommendations are grouped by destination and sent once to
`/placements/groups`. The server applies up to 20 destination groups in one
transaction and returns one aggregate change set, so a failure rolls back every
group and Undo restores the entire approved preview.

When the existing Tree has no suitable branch, the preview can include a
`proposed_workstreams` entry and Task suggestions can reference its preview-local
key through `proposed_parent_key`. The grouped apply translates each selected
proposal into a `create_parent` destination:

```json
{
  "todo_ids": ["todo_format", "todo_deadline"],
  "project_id": "project_paper",
  "parent_id": null,
  "create_parent": {
    "title": "Submission",
    "description": "Conference submission preparation",
    "parent_id": null
  },
  "inbox_state": "none"
}
```

The response exposes created containers in `created_todos`. The shared Undo
restores the selected Tasks and removes the created containers, while stale or
later-edited graphs fail closed.

```json
{
  "project_id": "project_paper",
  "parent_id": "todo_figures",
  "before_id": null,
  "inbox_state": "none",
  "expected_graph_revision": 32
}
```

```json
{
  "todo": { "id": "todo_figure3", "project_id": "project_paper" },
  "graph_revision": 35,
  "affected_task_ids": ["todo_figure3"],
  "insights_delta": {
    "ready_count": -1,
    "blocked_count": 1,
    "critical_path_minutes": 120
  },
  "change_set_id": "placement_123",
  "reverted": false
}
```

The server validates Project/parent consistency, prevents parent cycles, moves
the full subtree to the new Project, and renumbers affected sibling groups in
one transaction. A null parent in a Project is stored beneath that Project's
hidden compatibility root so scoped Graph traversal remains complete. Undo
fails closed after a later semantic Graph or placement-owned field change.

### Plan

```
POST   /api/todos/:id/plan/generate         # Generate and persist a validated proposal
GET    /api/todos/:id/plan/latest           # Get the latest proposal/history entry
POST   /api/todos/:id/plan/apply            # Atomically apply one exact proposal revision
POST   /api/todos/:id/plan/dismiss          # Reject one exact proposal
POST   /api/change-sets/:id/revert          # Conservatively undo an applied change set
```

Planning is a versioned change-set workflow, not a direct conversion of an LLM
response into Todos:

```text
capture graph revision
  -> strict schema + semantic validation
  -> preview proposal_id/base_graph_revision
  -> compare-and-swap apply
  -> change set + inverse operations + Vault outbox in one transaction
```

The generated response includes `proposal_id`, `base_graph_revision`, proposal
`status`, deterministic `validation`, a summarized `diff`, and editable
`subtasks`. Imported legacy proposals have a null base revision and cannot be
applied or reverted; clients must regenerate them.

Apply must echo the exact proposal identity and revision shown in the preview:

```json
{
  "proposal_id": "proposal_abc123",
  "base_graph_revision": 17,
  "selected_indices": [0, 1],
  "subtasks": [
    {
      "title": "Collect data",
      "estimated_minutes": 120,
      "priority": "high",
      "depends_on_indices": []
    },
    {
      "title": "Analyze results",
      "estimated_minutes": 180,
      "priority": "medium",
      "depends_on_indices": [0]
    }
  ]
}
```

Successful apply returns stable created IDs plus a `change_set_id` and
`applied_graph_revision`. Repeating the same canonical request replays that
response without creating duplicate tasks. Reusing the proposal with different
edits, applying after any semantic graph mutation, or undoing after subsequent
graph/user side effects returns `409`; there is no force-apply or destructive
force-undo path.

Generate, apply, dismiss, and revert fail closed on network errors. Both the
hand-written hooks and the OpenAPI-generated fetcher opt these revision-sensitive
commands out of the generic offline mutation queue, so they cannot replay later
against a different graph.

Selection is dependency-closed. The server also rejects malformed dates or
priorities, dangling/self dependencies, duplicate edges or titles, cycles,
unknown skills, unsafe Vault project names, and due-date inconsistencies.

Apply and revert never perform filesystem I/O inside their database transaction.
They return the Vault outbox state, normally `pending`; a durable worker then
reconciles managed `<!-- claw:id -->` markers while preserving user-authored
Markdown content.

### Delegate / Skills

```
POST   /api/todos/:id/delegate              # Assign a skill to a task
GET    /api/todos/skills/list               # List available skills
```

```json
// POST delegate — Request
{
  "skill_id": "research"          // preferred (any registered skill ID)
  // "agent_type": "planner"      // legacy fallback, mapped to skill ID
}

// POST delegate — Response 200
{
  "status": "delegated",
  "task_id": "task_abc123",
  "skill_id": "research",
  "skill_chain": ["research"],
  "agent_type": "research"
}

// GET skills/list — Response 200
{
  "skills": [
    { "id": "plan", "name": "Plan", "description": "...", "tags": ["planning"] },
    { "id": "research", "name": "Research", "description": "...", "tags": ["analysis"] }
  ]
}
```

---

## Obsidian Vault Endpoints

All require JWT authentication.

```
GET    /api/obsidian/health                  # Vault status, CLI availability, write queue
GET    /api/obsidian/index                   # Vault file index (cached)
POST   /api/obsidian/index/refresh           # Trigger re-index
GET    /api/obsidian/cli-commands            # List available Obsidian CLI commands
POST   /api/obsidian/cli-commands/:id        # Execute an Obsidian CLI command
GET    /api/obsidian/queue                   # Write queue status
POST   /api/obsidian/queue/flush             # Replay queued write operations
DELETE /api/obsidian/queue                   # Clear the write queue
```

#### `GET /api/obsidian/health`

```json
// Response 200
{
  "vault_path": "/path/to/vault",
  "vault_accessible": true,
  "cli_available": true,
  "sync_mode": "filesystem",
  "write_queue": {
    "pending": 0
  }
}
```

---

## AI Intent Classification

When a user message is sent via `POST /api/chat/send`, the backend classifies the intent before routing to the appropriate handler.

### Supported Intents

| Intent             | Description                              | Module             |
| ------------------ | ---------------------------------------- | ------------------ |
| `general_chat`     | General conversation, no specific action | AI Chat            |
| `create_todo`      | Create a new task                        | Todo Service       |
| `query_todos`      | List or search tasks                     | Todo Service       |
| `update_todo`      | Modify an existing task                  | Todo Service       |
| `delete_todo`      | Remove a task                            | Todo Service       |
| `complete_todo`    | Mark a task as done                      | Todo Service       |
| `create_event`     | Create a calendar event                  | Calendar Service   |
| `query_events`     | List or search events                    | Calendar Service   |
| `update_event`     | Modify an existing event                 | Calendar Service   |
| `delete_event`     | Remove an event                          | Calendar Service   |
| `search`           | Full-text search across all data         | Search Service     |
| `delegate_task`    | Assign an async task to the AI agent     | Agent Service      |
| `daily_briefing`   | Request today's summary                  | Briefing Service   |
| `suggest_time`     | Suggest available time slots             | Scheduling Service |
| `check_conflicts`  | Check for scheduling conflicts           | Scheduling Service |
| `analyze_schedule` | Analyze schedule patterns                | Scheduling Service |

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

| HTTP Status | Code               | Description                              |
| ----------- | ------------------ | ---------------------------------------- |
| 400         | `VALIDATION_ERROR` | Invalid request body or parameters       |
| 401         | `UNAUTHORIZED`     | Missing or invalid JWT token             |
| 403         | `FORBIDDEN`        | Token valid but insufficient permissions |
| 404         | `NOT_FOUND`        | Resource does not exist                  |
| 409         | `CONFLICT`         | Resource conflict (e.g., duplicate)      |
| 422         | `UNPROCESSABLE`    | Semantically invalid request             |
| 429         | `RATE_LIMITED`     | Too many requests                        |
| 500         | `INTERNAL_ERROR`   | Unexpected server error                  |
| 503         | `AI_UNAVAILABLE`   | LLM provider is unreachable              |
