"""Full-text search service across todos, events, memos, and messages."""

from datetime import datetime
from typing import Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from models.conversation import Conversation
from models.event import Event
from models.memo import Memo
from models.message import Message
from models.todo import Todo


def _highlight_snippet(text: str, query: str, max_len: int = 150) -> str:
    """Return a snippet of *text* with the first occurrence of *query* highlighted in bold markdown."""
    if not text or not query:
        return text[:max_len] if text else ""

    lower_text = text.lower()
    lower_query = query.lower()
    idx = lower_text.find(lower_query)

    if idx == -1:
        return text[:max_len]

    # Build a window around the match
    start = max(0, idx - 40)
    end = min(len(text), idx + len(query) + 80)
    snippet = text[start:end]

    # Bold the matched term
    match_start = idx - start
    match_end = match_start + len(query)
    snippet = (
        snippet[:match_start]
        + "**"
        + snippet[match_start:match_end]
        + "**"
        + snippet[match_end:]
    )

    if start > 0:
        snippet = "..." + snippet
    if end < len(text):
        snippet = snippet + "..."

    return snippet


def _simple_score(text: str, query: str) -> float:
    """Compute a naive relevance score (0-1) based on how often *query* appears."""
    if not text or not query:
        return 0.0
    lower_text = text.lower()
    lower_query = query.lower()
    count = lower_text.count(lower_query)
    if count == 0:
        return 0.0
    # Normalize: cap at 1.0
    return min(1.0, count * len(query) / max(len(text), 1))


def search(
    db: Session,
    *,
    q: str,
    types: list[str],
    page: int = 1,
    limit: int = 20,
) -> tuple[list[dict], int]:
    """Search across the specified types and return (items, total).

    Each item is a dict with keys: type, id, title, snippet, score, created_at.
    """
    if not q or not q.strip():
        return [], 0

    query_term = q.strip()
    results: list[dict] = []

    # --- Todos ---
    if "todos" in types:
        like_pattern = f"%{query_term}%"
        todos = (
            db.query(Todo)
            .filter(
                or_(
                    Todo.title.ilike(like_pattern),
                    Todo.description.ilike(like_pattern),
                )
            )
            .all()
        )
        for todo in todos:
            combined = f"{todo.title} {todo.description or ''}"
            results.append(
                {
                    "type": "todo",
                    "id": todo.id,
                    "title": todo.title,
                    "snippet": _highlight_snippet(
                        todo.description or todo.title, query_term
                    ),
                    "score": _simple_score(combined, query_term),
                    "created_at": todo.created_at.isoformat() if todo.created_at else None,
                }
            )

    # --- Events ---
    if "events" in types:
        like_pattern = f"%{query_term}%"
        events = (
            db.query(Event)
            .filter(
                or_(
                    Event.title.ilike(like_pattern),
                    Event.description.ilike(like_pattern),
                    Event.location.ilike(like_pattern),
                )
            )
            .all()
        )
        for event in events:
            combined = f"{event.title} {event.description or ''} {event.location or ''}"
            results.append(
                {
                    "type": "event",
                    "id": event.id,
                    "title": event.title,
                    "snippet": _highlight_snippet(
                        event.description or event.title, query_term
                    ),
                    "score": _simple_score(combined, query_term),
                    "created_at": event.created_at.isoformat() if event.created_at else None,
                }
            )

    # --- Memos ---
    if "memos" in types:
        like_pattern = f"%{query_term}%"
        memos = (
            db.query(Memo)
            .filter(
                or_(
                    Memo.title.ilike(like_pattern),
                    Memo.content.ilike(like_pattern),
                )
            )
            .all()
        )
        for memo in memos:
            combined = f"{memo.title} {memo.content}"
            results.append(
                {
                    "type": "memo",
                    "id": memo.id,
                    "title": memo.title,
                    "snippet": _highlight_snippet(memo.content, query_term),
                    "score": _simple_score(combined, query_term),
                    "created_at": memo.created_at.isoformat() if memo.created_at else None,
                }
            )

    # --- Messages ---
    if "messages" in types:
        like_pattern = f"%{query_term}%"
        messages = (
            db.query(Message)
            .filter(Message.content.ilike(like_pattern))
            .all()
        )
        for msg in messages:
            # Look up conversation title for context
            conv = (
                db.query(Conversation)
                .filter(Conversation.id == msg.conversation_id)
                .first()
            )
            conv_title = conv.title if conv else "Unknown Conversation"
            results.append(
                {
                    "type": "message",
                    "id": msg.id,
                    "title": f"[{msg.role}] in {conv_title}",
                    "snippet": _highlight_snippet(msg.content, query_term),
                    "score": _simple_score(msg.content, query_term),
                    "created_at": msg.created_at.isoformat() if msg.created_at else None,
                }
            )

    # Sort by score descending
    results.sort(key=lambda r: r.get("score", 0), reverse=True)

    total = len(results)
    start = (page - 1) * limit
    end = start + limit
    paginated = results[start:end]

    return paginated, total
