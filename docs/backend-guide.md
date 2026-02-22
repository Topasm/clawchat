# Backend Guide

The ClawChat backend is a standalone Python FastAPI server in the **`clawchat_server`** repository. It handles REST API, SSE streaming, AI orchestration, and module CRUD.

> **Note:** The server was previously embedded in `clawchat/server/`. It now lives in its own repo at `clawchat_server/server/` for independent deployment and development.

## Directory Structure

```
clawchat_server/server/
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
│   ├── todo.py                 # Full CRUD /api/todos
│   ├── calendar.py             # Full CRUD /api/events
│   ├── memo.py                 # Full CRUD /api/memos
│   ├── attachment.py           # File upload/download /api/attachments
│   ├── admin.py                # Admin dashboard /api/admin/* (11 endpoints)
│   ├── search.py               # GET /api/search (stub)
│   ├── tags.py                 # GET /api/tags (aggregated tags)
│   ├── today.py                # GET /api/today (dashboard aggregation)
│   └── notifications.py        # POST /api/notifications/register-token
├── models/
│   ├── __init__.py
│   ├── conversation.py         # Conversation model
│   ├── message.py              # Message model (role, content, message_type, intent)
│   ├── todo.py                 # Todo model (status, priority, completed_at, tags)
│   ├── event.py                # Event model (start/end time, is_all_day, reminder, tags)
│   ├── memo.py                 # Memo model (title, content, tags)
│   ├── attachment.py           # Attachment model (filename, content_type, memo_id, todo_id)
│   └── agent_task.py           # AgentTask model (queued async work)
├── schemas/
│   ├── __init__.py
│   ├── common.py               # PaginatedResponse
│   ├── auth.py                 # Login/token schemas
│   ├── chat.py                 # SendMessageRequest, MessageEditRequest, conversation/message responses
│   ├── todo.py                 # TodoCreate, TodoUpdate, TodoResponse
│   ├── calendar.py             # EventCreate, EventUpdate, EventResponse
│   ├── memo.py                 # MemoCreate, MemoUpdate, MemoResponse
│   ├── attachment.py           # AttachmentResponse
│   ├── admin.py                # Admin response models (overview, AI config, activity, sessions, config, data, purge, reindex, backup)
│   ├── today.py                # TodayResponse
│   ├── search.py               # SearchHit, search response schema
├── services/
│   ├── __init__.py
│   ├── ai_service.py           # LLM client (Ollama native + OpenAI-compatible)
│   ├── intent_classifier.py    # Intent classification via function calling (16 intents)
│   ├── orchestrator.py         # Routes intents to services, streams via WebSocket
│   ├── todo_service.py         # Async todo CRUD with completed_at auto-set
│   ├── calendar_service.py     # Async event CRUD with recurrence support
│   ├── memo_service.py         # Async memo CRUD
│   ├── search_service.py       # FTS5 full-text search
│   ├── agent_task_service.py   # Background task execution pipeline
│   ├── briefing_service.py     # Daily briefing generation
│   ├── admin_service.py        # Admin: table counts, storage, uptime, activity, purge, reindex, backup
│   ├── reminder_service.py     # Event/todo reminder checks
│   ├── recurrence_service.py   # Recurring event expansion
│   └── scheduler.py            # Background loops (reminders, briefing)
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
general_chat  → LLM streaming via WebSocket
create_todo   → todo_service.create_todo()
query_todos   → todo_service.get_todos()
create_event  → calendar_service.create_event()
query_events  → calendar_service.get_events()
create_memo   → memo_service.create_memo()
query_memos   → memo_service.get_memos()
search        → stub (coming soon)
delegate_task → stub (coming soon)
daily_briefing → stub (coming soon)
```

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
```

## Development Setup

```bash
# Navigate to server
cd clawchat_server/server

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
