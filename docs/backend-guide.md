# Backend Guide

The ClawChat backend is a Python FastAPI server in the `server/` directory of the main repository. It handles REST API, SSE streaming, AI orchestration, and module CRUD.

## Directory Structure

```
server/
├── main.py                     # FastAPI app entry point (async lifespan)
├── config.py                   # Pydantic Settings from .env
├── database.py                 # Async SQLAlchemy engine + session factory
├── utils.py                    # Utilities: make_id(), serialize_tags/deserialize_tags, apply_model_updates, strip_markdown_fences
├── constants.py                # Shared constants (SYSTEM_PROMPT)
├── exceptions.py               # AppError hierarchy + error handler
├── requirements.txt            # Python dependencies
├── .env.example                # Example environment config
├── routers/
│   ├── __init__.py
│   ├── auth.py                 # POST /api/auth/* (login, refresh, logout)
│   ├── chat.py                 # SSE /stream, message CRUD, conversations
│   ├── todo.py                 # Full CRUD /api/todos + organize, delegate, plan
│   ├── tasks.py                # Task management /api/tasks (planning, agent tasks)
│   ├── task_relationship.py    # Task relationships /api/task-relationships
│   ├── calendar.py             # Full CRUD /api/events
│   ├── attachment.py           # File upload/download /api/attachments
│   ├── admin.py                # Admin dashboard /api/admin/* (11 endpoints)
│   ├── obsidian.py             # Obsidian vault /api/obsidian/* (health, index, CLI, queue)
│   ├── search.py               # GET /api/search
│   ├── settings.py             # User settings /api/settings
│   ├── tags.py                 # GET /api/tags (aggregated tags)
│   ├── today.py                # GET /api/today (dashboard aggregation)
│   ├── pairing.py              # Device pairing /api/pairing
│   └── notifications.py        # POST /api/notifications/register-token
├── models/
│   ├── __init__.py
│   ├── conversation.py         # Conversation model
│   ├── message.py              # Message model (role, content, message_type, intent)
│   ├── todo.py                 # Todo model (status, priority, completed_at, tags)
│   ├── event.py                # Event model (start/end time, is_all_day, reminder, tags)
│   ├── attachment.py           # Attachment model (filename, content_type, todo_id)
│   ├── agent_task.py           # AgentTask model (queued async work)
│   ├── task_relationship.py    # TaskRelationship model (blocks, related, duplicate_of)
│   ├── paired_device.py        # PairedDevice model (device pairing)
│   └── user_settings.py        # UserSettings model
├── schemas/
│   ├── __init__.py
│   ├── common.py               # PaginatedResponse
│   ├── auth.py                 # Login/token schemas
│   ├── chat.py                 # SendMessageRequest, MessageEditRequest, conversation/message responses
│   ├── todo.py                 # TodoCreate, TodoUpdate, TodoResponse
│   ├── calendar.py             # EventCreate, EventUpdate, EventResponse
│   ├── task.py                 # Task management schemas
│   ├── task_relationship.py    # TaskRelationship schemas
│   ├── bulk.py                 # Bulk operation schemas
│   ├── attachment.py           # AttachmentResponse
│   ├── admin.py                # Admin response models (overview, AI config, activity, sessions, config, data, purge, reindex, backup)
│   ├── today.py                # TodayResponse
│   ├── search.py               # SearchHit, search response schema
│   ├── settings.py             # User settings schemas
│   ├── pairing.py              # Device pairing schemas
│   ├── claude_code.py          # Claude Code integration schemas
├── services/
│   ├── __init__.py
│   ├── ai_service.py           # LLM client (Ollama native + OpenAI-compatible)
│   ├── intent_classifier.py    # Intent classification via function calling (16 intents)
│   ├── orchestrator.py         # Routes intents to services, streams via WebSocket
│   ├── todo_service.py         # Async todo CRUD with completed_at auto-set
│   ├── todo_planning_service.py # Todo planning and subtask generation
│   ├── calendar_service.py     # Async event CRUD with recurrence support
│   ├── scheduling_service.py   # Event scheduling suggestions and conflict detection
│   ├── search_service.py       # FTS5 full-text search
│   ├── claude_code_provider.py # Claude Code integration provider
│   ├── agent_task_service.py   # Background task execution pipeline
│   ├── inbox_pipeline_service.py # Inbox classification + auto-assignment
│   ├── obsidian_cli_service.py  # Obsidian CLI wrapper + write queue
│   ├── obsidian_context_service.py # Vault project context for AI planning
│   ├── obsidian_export_service.py  # Export todos/plans to vault markdown
│   ├── obsidian_vault_indexer.py   # Vault file indexing + companion health
│   ├── vault_agent_service.py      # AI agent for vault-aware planning
│   ├── vault_watcher_service.py   # Vault file watching service
│   ├── briefing_service.py     # Daily briefing generation
│   ├── admin_service.py        # Admin: table counts, storage, uptime, activity, purge, reindex, backup
│   ├── reminder_service.py     # Event/todo reminder checks
│   ├── recurrence_service.py   # Recurring event expansion
│   └── scheduler.py            # Background loops (reminders, briefing, queue flush)
├── ws/
│   ├── __init__.py
│   ├── manager.py              # WebSocket ConnectionManager
│   └── handler.py              # WebSocket message router
├── auth/
│   ├── __init__.py
│   ├── jwt.py                  # JWT creation and verification
│   └── dependencies.py         # get_current_user FastAPI dependency
└── data/
    ├── clawchat.db             # SQLite database (auto-created)
    └── uploads/                # Uploaded attachment files (auto-created)
```

## Key Modules

### `main.py` — Application Entry Point

Uses FastAPI's async lifespan to initialize the database, AI service, and orchestrator at startup.

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()

    ai_service = AIService(
        base_url=settings.ai_base_url,
        api_key=settings.ai_api_key,
        model=settings.ai_model,
        provider=settings.ai_provider,  # "ollama" or "openai"
    )
    app.state.ai_service = ai_service
    app.state.session_factory = async_session_factory

    app.state.orchestrator = Orchestrator(
        ai_service=ai_service,
        ws_manager=ws_manager,
        session_factory=async_session_factory,
    )

    app.state.ai_connected = await ai_service.health_check()
    yield
    await ai_service.close()
```

### `services/ai_service.py` — AI Service

Supports two LLM providers with automatic routing based on the `provider` config:

| Provider | Streaming Endpoint | Format |
|----------|-------------------|--------|
| `ollama` | `POST /api/chat` | NDJSON (one JSON object per line) |
| `openai` | `POST /v1/chat/completions` | SSE (`data: {...}` lines) |

Function calling (for intent classification) always uses the OpenAI-compatible endpoint, which Ollama also supports.

### `routers/chat.py` — Chat Router

Handles two streaming paths:

| Endpoint | Transport | Use Case |
|----------|-----------|----------|
| `POST /api/chat/stream` | SSE | Primary — client streams tokens directly |
| `POST /api/chat/send` | WebSocket (via orchestrator) | Background — intent classification + module routing |

SSE streaming flow:
1. Save user message to DB
2. Load last 20 messages as context
3. Pre-create assistant message ID
4. Stream: meta event → token events → `[DONE]`
5. Save accumulated assistant message with fresh DB session

Message CRUD:
- `DELETE .../messages/:id` — delete a message
- `PUT .../messages/:id` — edit message content

### `services/orchestrator.py` — Intent Orchestrator

Routes classified intents to real service calls:

```
general_chat      → LLM streaming via WebSocket
create_todo       → todo_service.create_todo()
query_todos       → todo_service.get_todos()
update_todo       → todo_service.update_todo()
delete_todo       → todo_service.delete_todo()
complete_todo     → todo_service.complete_todo()
create_event      → calendar_service.create_event()
query_events      → calendar_service.get_events()
update_event      → calendar_service.update_event()
delete_event      → calendar_service.delete_event()
search            → search_service.search()
delegate_task     → agent_task_service (planner/researcher/executor personas)
daily_briefing    → briefing_service.generate_briefing()
suggest_time      → scheduling_service (time suggestion)
check_conflicts   → scheduling_service (conflict detection)
analyze_schedule  → scheduling_service (schedule analysis)
```

### Obsidian Vault Integration

The server integrates with Obsidian vaults via the official Obsidian CLI (using `key=value` parameter syntax). All CLI operations fall back to direct filesystem access if the CLI is unavailable.

**CLI command syntax** (matches [official Obsidian CLI](https://obsidian.md/help/Extending+Obsidian/Obsidian+CLI)):
```
obsidian version                              # Health check
obsidian create path=<path> content=<text>    # Create document
obsidian append path=<path> content=<text>    # Append to document
obsidian rename path=<path> name=<name>       # Rename (updates internal links)
obsidian move path=<path> to=<new_path>       # Move (updates internal links)
obsidian search query=<text>                  # Full-text search
obsidian files folder=<path>                  # List vault files
obsidian commands                             # List plugin commands
obsidian command id=<command_id>              # Execute plugin command
```

**Write queue**: Failed CLI operations are queued to `/data/obsidian_write_queue.json` and replayed when the Companion Node comes online. The scheduler periodically flushes the queue.

**Sync modes** (`OBSIDIAN_SYNC_MODE`): `filesystem` (direct file access), `livesync` (CouchDB + LiveSync plugin), or `disabled`.

### Inbox Pipeline & Agent Personas

New todos captured via quick-capture enter the inbox pipeline (`inbox_pipeline_service.py`):
1. LLM classifies the todo and suggests an assignee persona
2. Available personas: `planner` (creates plans/subtasks), `researcher` (investigates), `executor` (takes action)
3. The `openclaw` assignee represents general AI assignment

The `POST /api/todos/{id}/organize` endpoint triggers the pipeline as a background task with a fresh DB session (via `session_factory`, not the request-scoped session).

Delegation: `POST /api/todos/{id}/delegate` assigns a todo to an agent persona and creates an `AgentTask` for background execution.

### `services/intent_classifier.py` — Intent Classification

Uses LLM function calling to classify user messages into 16 actionable intents with parameter extraction.

## Configuration

All configuration via environment variables, loaded by Pydantic Settings in `config.py`.

### `.env` Variables

```bash
# Server
HOST=0.0.0.0
PORT=8000

# Database (async SQLite)
DATABASE_URL=sqlite+aiosqlite:///./data/clawchat.db

# Authentication
JWT_SECRET=your-secret-key-change-in-production
JWT_EXPIRY_HOURS=24
PIN=123456

# AI Provider
AI_PROVIDER=ollama                          # "ollama" or "openai"
AI_BASE_URL=http://localhost:11434          # Ollama default
AI_API_KEY=                                 # Required for OpenAI/Claude
AI_MODEL=llama3.2                           # Model name

# File Uploads
UPLOAD_DIR=data/uploads                     # Directory for uploaded files
MAX_UPLOAD_SIZE_MB=10                       # Max file size in MB
ALLOWED_EXTENSIONS=jpg,jpeg,png,gif,webp,svg,pdf,txt,md,zip

# Scheduler (optional)
ENABLE_SCHEDULER=false
BRIEFING_TIME=08:00                         # Daily briefing time (HH:MM)
REMINDER_CHECK_INTERVAL=5                   # Minutes between reminder checks
DEBUG=false

# Obsidian Vault Integration (optional)
OBSIDIAN_VAULT_PATH=                        # Absolute path to vault
OBSIDIAN_CLI_COMMAND=                       # Path to obsidian CLI binary
OBSIDIAN_SYNC_MODE=filesystem               # "livesync", "filesystem", or "disabled"
OBSIDIAN_PROJECT_TODO_FILENAME=TODO.md      # Filename to scan for project todos
OBSIDIAN_SCAN_INTERVAL_MINUTES=5            # Vault re-index interval
```

## Development Setup

```bash
# Navigate to server
cd server

# Create virtual environment
python -m venv venv
source venv/Scripts/activate  # Windows
# source venv/bin/activate    # Linux/Mac

# Install dependencies
pip install -r requirements.txt

# Copy and edit environment config
cp .env.example .env

# Start development server
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The server is now accessible at `http://localhost:8000`.
- Swagger docs: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## Connecting the Client

In the ClawChat client, go to Settings and set the server URL to `http://localhost:8000` (or your server's address). Enter the PIN configured in `.env` to authenticate.
