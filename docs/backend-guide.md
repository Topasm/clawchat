# Backend Guide

The ClawChat server is a Python FastAPI application handling REST API, SSE (Server-Sent Events) streaming, AI orchestration, and scheduled tasks.

## Directory Structure

```
server/
├── main.py                     # FastAPI app entry point
├── config.py                   # Settings from environment variables
├── database.py                 # SQLAlchemy engine, session, base
├── requirements.txt            # Python dependencies
├── alembic.ini                 # Alembic migration config
├── alembic/
│   ├── env.py
│   └── versions/               # Migration files
├── routers/
│   ├── __init__.py
│   ├── auth.py                 # POST /api/auth/*
│   ├── chat.py                 # Chat endpoints: send, stream (SSE), conversations, message CRUD
│   ├── todo.py                 # CRUD /api/todos
│   ├── calendar.py             # CRUD /api/events
│   ├── memo.py                 # CRUD /api/memos
│   ├── search.py               # GET /api/search
│   ├── today.py                # GET /api/today (consolidated dashboard)
│   └── notifications.py        # POST /api/notifications/register-token
├── models/
│   ├── __init__.py
│   ├── conversation.py         # Conversation SQLAlchemy model
│   ├── message.py              # Message model
│   ├── todo.py                 # Todo model
│   ├── event.py                # Event model
│   ├── memo.py                 # Memo model
│   └── agent_task.py           # AgentTask model
├── schemas/
│   ├── __init__.py
│   ├── chat.py                 # Chat schemas (send, stream, message edit, responses)
│   ├── todo.py                 # Todo schemas
│   ├── calendar.py             # Event schemas
│   ├── memo.py                 # Memo schemas
│   ├── common.py               # Shared schemas (pagination, error, etc.)
│   └── today.py                # Today dashboard response schema
├── services/
│   ├── __init__.py
│   ├── ai_service.py           # LLM client (OpenAI-compatible)
│   ├── intent_classifier.py    # Intent classification via function calling
│   ├── orchestrator.py         # Routes intents to module services
│   ├── todo_service.py         # Todo CRUD operations
│   ├── calendar_service.py     # Event CRUD operations
│   ├── memo_service.py         # Memo CRUD operations
│   ├── search_service.py       # Full-text search across tables
│   ├── agent_service.py        # Async task execution
│   └── scheduler.py            # APScheduler reminder & overdue checker
├── ws/                             # Legacy — SSE replaced WebSocket for streaming
│   ├── __init__.py
│   ├── manager.py              # WebSocket connection manager (future: push notifications)
│   └── handler.py              # WebSocket message router
├── auth/
│   ├── __init__.py
│   ├── jwt.py                  # JWT creation and verification
│   └── dependencies.py         # FastAPI auth dependencies
└── scheduler/
    ├── __init__.py
    └── tasks.py                # Scheduled tasks (briefing, reminders)
```

## Key Modules

### `main.py` — Application Entry Point

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from database import engine, Base
from routers import auth, chat, todo, calendar, memo, search, today, notifications
from scheduler.tasks import start_scheduler

app = FastAPI(title="ClawChat Server", version="0.1.0")

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# Include routers
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])  # includes /stream SSE endpoint
app.include_router(todo.router, prefix="/api/todos", tags=["todos"])
app.include_router(calendar.router, prefix="/api/events", tags=["calendar"])
app.include_router(memo.router, prefix="/api/memos", tags=["memos"])
app.include_router(search.router, prefix="/api/search", tags=["search"])
app.include_router(today.router, prefix="/api/today", tags=["today"])
app.include_router(notifications.router, prefix="/api/notifications", tags=["notifications"])

@app.on_event("startup")
async def startup():
    Base.metadata.create_all(bind=engine)
    start_scheduler()

@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "0.1.0", "ai_provider": settings.ai_provider}
```

### `services/intent_classifier.py` — Intent Classification

Uses LLM function calling to classify user messages into actionable intents.

```python
CLASSIFY_PROMPT = """You are an intent classifier for a personal assistant.
Given a user message, classify it into one of these intents:
- general_chat: General conversation
- create_todo / query_todos / update_todo / delete_todo / complete_todo
- create_event / query_events / update_event / delete_event
- create_memo / query_memos / update_memo / delete_memo
- search: Cross-module search
- delegate_task: Async agent task
- daily_briefing: Summary request

Extract relevant parameters (title, due_date, priority, etc.) from the message."""

async def classify_intent(message: str, ai_service: AIService) -> IntentResult:
    response = await ai_service.function_call(
        system_prompt=CLASSIFY_PROMPT,
        user_message=message,
        functions=[INTENT_FUNCTION_SCHEMA],
    )
    return IntentResult.parse(response)
```

The function schema defines all possible intents with their parameters, allowing the LLM to extract structured data (e.g., `{"intent": "create_event", "params": {"title": "VLA Review", "start_time": "2026-02-22T15:00:00Z"}}`) from natural language input.

### `services/ai_service.py` — AI Service

Wraps any OpenAI-compatible API (Ollama, OpenAI, Claude via proxy).

```python
import httpx

class AIService:
    def __init__(self, base_url: str, api_key: str, model: str):
        self.base_url = base_url
        self.api_key = api_key
        self.model = model
        self.client = httpx.AsyncClient()

    async def stream_completion(self, messages: list[dict]) -> AsyncIterator[str]:
        """Stream chat completion tokens."""
        async with self.client.stream(
            "POST",
            f"{self.base_url}/v1/chat/completions",
            json={"model": self.model, "messages": messages, "stream": True},
            headers={"Authorization": f"Bearer {self.api_key}"},
        ) as response:
            async for line in response.aiter_lines():
                if line.startswith("data: ") and line != "data: [DONE]":
                    chunk = json.loads(line[6:])
                    if content := chunk["choices"][0]["delta"].get("content"):
                        yield content

    async def function_call(self, system_prompt: str, user_message: str, functions: list) -> dict:
        """Single function call (used for intent classification)."""
        response = await self.client.post(
            f"{self.base_url}/v1/chat/completions",
            json={
                "model": self.model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message},
                ],
                "functions": functions,
                "function_call": "auto",
            },
            headers={"Authorization": f"Bearer {self.api_key}"},
        )
        return response.json()
```

### `routers/chat.py` — Chat Router (SSE Streaming + Message CRUD)

Handles all chat endpoints including SSE streaming for real-time AI responses and full message CRUD.

**Key endpoints:**

| Endpoint | Description |
|----------|-------------|
| `POST /api/chat/send` | Send message with echo-mode fallback |
| `POST /api/chat/stream` | Send message and stream AI response via SSE |
| `GET /api/chat/conversations` | List conversations (paginated) |
| `POST /api/chat/conversations` | Create a new conversation |
| `GET /api/chat/conversations/:id/messages` | Get messages (paginated) |
| `DELETE /api/chat/conversations/:id/messages/:mid` | Delete a message |
| `PUT /api/chat/conversations/:id/messages/:mid` | Edit a message |

```python
from fastapi.responses import StreamingResponse

@router.post("/stream")
async def stream_send(body: StreamSendRequest, db: Session = Depends(get_db)):
    """SSE endpoint — streams AI response tokens to the client."""

    async def _stream_tokens():
        # 1. Emit metadata event (conversation_id, message_id)
        yield f"data: {json.dumps({'conversation_id': ..., 'message_id': ...})}\n\n"

        # 2. Generate tokens from LLM and yield each one
        for token in _generate_response(body.content):
            yield f"data: {json.dumps({'token': token})}\n\n"

        # 3. Signal completion
        yield "data: [DONE]\n\n"

    return StreamingResponse(_stream_tokens(), media_type="text/event-stream")
```

The frontend consumes this using `fetch()` with a `ReadableStream` reader (`app/services/sseClient.js`). An `AbortController` allows the user to stop generation mid-stream.

### `services/orchestrator.py` — Intent Orchestrator

Routes classified intents to the appropriate service and manages the response pipeline.

```python
class Orchestrator:
    def __init__(self, ai_service, todo_service, calendar_service, memo_service):
        self.ai = ai_service
        self.todo = todo_service
        self.calendar = calendar_service
        self.memo = memo_service

    async def handle_message(self, conversation_id: str, content: str):
        # 1. Classify intent
        intent_result = await classify_intent(content, self.ai)

        # 2. Route to handler
        match intent_result.intent:
            case "create_todo":
                todo = await self.todo.create(intent_result.params)
                return {"type": "action_card", "card_type": "todo_created", "payload": todo.dict()}
            case "create_event":
                event = await self.calendar.create(intent_result.params)
                return {"type": "action_card", "card_type": "event_created", "payload": event.dict()}
            case "general_chat":
                # Tokens are streamed via SSE through POST /api/chat/stream
                return self.ai.stream_completion(messages)
            # ... other intents
```

## Configuration

All configuration is via environment variables, loaded in `config.py`.

### `.env` Variables

```bash
# Server
HOST=0.0.0.0
PORT=8000
DEBUG=false

# Database
DATABASE_URL=sqlite:///./data/clawchat.db

# Authentication
JWT_SECRET=your-secret-key-change-in-production
JWT_EXPIRY_HOURS=24
PIN=123456

# AI Provider
AI_PROVIDER=ollama                          # "ollama" or "openai"
AI_BASE_URL=http://localhost:11434          # Ollama default
AI_API_KEY=                                 # Required for OpenAI/Claude
AI_MODEL=llama3.2                           # Model name

# Scheduler
ENABLE_SCHEDULER=true
BRIEFING_TIME=08:00                         # Daily briefing time (HH:MM)
REMINDER_CHECK_INTERVAL=60                  # Seconds between reminder checks
```

## Development Setup

```bash
# Clone and navigate
cd server

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Linux/Mac
# or: venv\Scripts\activate  # Windows

# Install dependencies
# Includes apscheduler>=3.10.0 and exponent-server-sdk>=2.0.0
pip install -r requirements.txt

# Copy and edit environment config
cp .env.example .env
# Edit .env with your settings

# Run database migrations
alembic upgrade head

# Start development server
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The server is now accessible at `http://localhost:8000`. API docs are available at `http://localhost:8000/docs` (Swagger) and `http://localhost:8000/redoc` (ReDoc).
