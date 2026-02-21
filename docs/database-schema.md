# Database Schema

ClawChat uses a single SQLite database storing all user data on the self-hosted server. The schema is managed via SQLAlchemy models with Alembic migrations.

## Entity Relationship Overview

```
conversations 1──N messages
messages      N──1 conversations
todos         (standalone, linked via conversation_id)
events        (standalone, linked via conversation_id)
memos         (standalone, linked via conversation_id)
agent_tasks   (standalone, linked via conversation_id)
```

All module tables (`todos`, `events`, `memos`) link back to the `conversation_id` and `message_id` that created them, enabling full traceability.

---

## Tables

### `conversations`

Stores chat conversation metadata.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT (UUID) | PRIMARY KEY | Unique conversation identifier |
| `title` | TEXT | NOT NULL, DEFAULT '' | Conversation title (auto-generated or user-set) |
| `created_at` | TIMESTAMP | NOT NULL, DEFAULT NOW | When the conversation was created |
| `updated_at` | TIMESTAMP | NOT NULL, DEFAULT NOW | Last activity timestamp (updated on new message) |
| `is_archived` | BOOLEAN | NOT NULL, DEFAULT FALSE | Whether the conversation is archived |
| `metadata` | JSON | NULLABLE | Optional metadata (e.g., pinned status, tags) |

### `messages`

Stores individual messages within conversations.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT (UUID) | PRIMARY KEY | Unique message identifier |
| `conversation_id` | TEXT (UUID) | FOREIGN KEY -> conversations.id, NOT NULL | Parent conversation |
| `role` | TEXT | NOT NULL, CHECK IN ('user', 'assistant', 'system') | Message sender role |
| `content` | TEXT | NOT NULL | Message text content |
| `message_type` | TEXT | NOT NULL, DEFAULT 'text' | Type: 'text', 'action_card', 'image', 'system' |
| `intent` | TEXT | NULLABLE | Classified intent (e.g., 'create_todo', 'query_calendar') |
| `metadata` | JSON | NULLABLE | Extra data (action card payload, intent params, etc.) |
| `created_at` | TIMESTAMP | NOT NULL, DEFAULT NOW | When the message was sent |

### `todos`

Stores task/to-do items, created via conversation or direct API.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT (UUID) | PRIMARY KEY | Unique todo identifier |
| `title` | TEXT | NOT NULL | Task title |
| `description` | TEXT | NULLABLE | Detailed task description |
| `status` | TEXT | NOT NULL, DEFAULT 'pending' | Status: 'pending', 'in_progress', 'completed', 'cancelled' |
| `priority` | TEXT | NOT NULL, DEFAULT 'medium' | Priority: 'low', 'medium', 'high', 'urgent' |
| `due_date` | TIMESTAMP | NULLABLE | Task deadline |
| `completed_at` | TIMESTAMP | NULLABLE | When the task was completed |
| `conversation_id` | TEXT (UUID) | FOREIGN KEY -> conversations.id, NULLABLE | Conversation that created this todo |
| `message_id` | TEXT (UUID) | FOREIGN KEY -> messages.id, NULLABLE | Message that created this todo |
| `created_at` | TIMESTAMP | NOT NULL, DEFAULT NOW | Creation timestamp |
| `updated_at` | TIMESTAMP | NOT NULL, DEFAULT NOW | Last modification timestamp |
| `tags` | JSON | NULLABLE | Array of string tags for categorization |

### `events`

Stores calendar events.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT (UUID) | PRIMARY KEY | Unique event identifier |
| `title` | TEXT | NOT NULL | Event title |
| `description` | TEXT | NULLABLE | Event description or notes |
| `start_time` | TIMESTAMP | NOT NULL | Event start datetime |
| `end_time` | TIMESTAMP | NULLABLE | Event end datetime |
| `location` | TEXT | NULLABLE | Event location |
| `is_all_day` | BOOLEAN | NOT NULL, DEFAULT FALSE | Whether this is an all-day event |
| `reminder_minutes` | INTEGER | NULLABLE | Minutes before event to send reminder |
| `recurrence_rule` | TEXT | NULLABLE | iCal RRULE string for recurring events |
| `conversation_id` | TEXT (UUID) | FOREIGN KEY -> conversations.id, NULLABLE | Conversation that created this event |
| `message_id` | TEXT (UUID) | FOREIGN KEY -> messages.id, NULLABLE | Message that created this event |
| `created_at` | TIMESTAMP | NOT NULL, DEFAULT NOW | Creation timestamp |
| `updated_at` | TIMESTAMP | NOT NULL, DEFAULT NOW | Last modification timestamp |
| `tags` | JSON | NULLABLE | Array of string tags |

### `memos`

Stores notes and text snippets.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT (UUID) | PRIMARY KEY | Unique memo identifier |
| `title` | TEXT | NOT NULL | Memo title |
| `content` | TEXT | NOT NULL | Memo body (plain text or markdown) |
| `conversation_id` | TEXT (UUID) | FOREIGN KEY -> conversations.id, NULLABLE | Conversation that created this memo |
| `message_id` | TEXT (UUID) | FOREIGN KEY -> messages.id, NULLABLE | Message that created this memo |
| `created_at` | TIMESTAMP | NOT NULL, DEFAULT NOW | Creation timestamp |
| `updated_at` | TIMESTAMP | NOT NULL, DEFAULT NOW | Last modification timestamp |
| `tags` | JSON | NULLABLE | Array of string tags |

### `agent_tasks`

Stores asynchronous AI agent tasks (research, summarization, etc.).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT (UUID) | PRIMARY KEY | Unique task identifier |
| `task_type` | TEXT | NOT NULL | Type: 'research', 'summarize', 'draft', 'custom' |
| `instruction` | TEXT | NOT NULL | User's original instruction for the agent |
| `status` | TEXT | NOT NULL, DEFAULT 'queued' | Status: 'queued', 'running', 'completed', 'failed' |
| `result` | TEXT | NULLABLE | Agent's output/result text |
| `error` | TEXT | NULLABLE | Error message if task failed |
| `conversation_id` | TEXT (UUID) | FOREIGN KEY -> conversations.id, NULLABLE | Conversation that triggered this task |
| `message_id` | TEXT (UUID) | FOREIGN KEY -> messages.id, NULLABLE | Message that triggered this task |
| `created_at` | TIMESTAMP | NOT NULL, DEFAULT NOW | When the task was queued |
| `started_at` | TIMESTAMP | NULLABLE | When execution began |
| `completed_at` | TIMESTAMP | NULLABLE | When execution finished |

---

## Indexes

```sql
-- Message lookup by conversation (most frequent query)
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);

-- Conversation ordering
CREATE INDEX idx_conversations_updated_at ON conversations(updated_at);

-- Todo queries (by status, due date)
CREATE INDEX idx_todos_status ON todos(status);
CREATE INDEX idx_todos_due_date ON todos(due_date);
CREATE INDEX idx_todos_conversation_id ON todos(conversation_id);

-- Event queries (by time range)
CREATE INDEX idx_events_start_time ON events(start_time);
CREATE INDEX idx_events_end_time ON events(end_time);
CREATE INDEX idx_events_conversation_id ON events(conversation_id);

-- Memo lookup
CREATE INDEX idx_memos_conversation_id ON memos(conversation_id);
CREATE INDEX idx_memos_updated_at ON memos(updated_at);

-- Agent task status monitoring
CREATE INDEX idx_agent_tasks_status ON agent_tasks(status);
CREATE INDEX idx_agent_tasks_conversation_id ON agent_tasks(conversation_id);
```

## Full-Text Search

SQLite's FTS5 extension enables full-text search across all content:

```sql
CREATE VIRTUAL TABLE fts_messages USING fts5(content, content=messages, content_rowid=rowid);
CREATE VIRTUAL TABLE fts_todos USING fts5(title, description, content=todos, content_rowid=rowid);
CREATE VIRTUAL TABLE fts_events USING fts5(title, description, content=events, content_rowid=rowid);
CREATE VIRTUAL TABLE fts_memos USING fts5(title, content, content=memos, content_rowid=rowid);
```

FTS tables are kept in sync via SQLAlchemy event hooks or database triggers.

---

## Migration Strategy

Migrations are managed with **Alembic** (SQLAlchemy's migration tool).

### Setup

```bash
# Initialize Alembic (one-time)
alembic init alembic

# Generate migration from model changes
alembic revision --autogenerate -m "description of change"

# Apply migrations
alembic upgrade head

# Rollback one step
alembic downgrade -1
```

### Conventions

- Migration files live in `server/alembic/versions/`
- Each migration has a descriptive message (e.g., `"add_tags_column_to_todos"`)
- The initial migration creates all tables from scratch
- Subsequent migrations handle additive schema changes (new columns, indexes)
- Destructive changes (column removal, type changes) require a two-step migration: add new -> migrate data -> remove old
