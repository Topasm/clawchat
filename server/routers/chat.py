"""Chat router: conversation CRUD, message send (echo), SSE streaming, and message management."""

import asyncio
import json
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from auth.dependencies import get_current_user
from database import get_db
from models.conversation import Conversation
from models.message import Message
from schemas.chat import (
    ConversationCreate,
    ConversationListResponse,
    ConversationResponse,
    MessageEditRequest,
    MessageListResponse,
    MessageResponse,
    SendMessageRequest,
    SendMessageResponse,
    StreamSendRequest,
)

router = APIRouter(tags=["chat"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _last_message_preview(db: Session, conversation_id: str) -> str:
    """Return the content of the most recent message in a conversation, truncated to 100 chars."""
    msg = (
        db.query(Message)
        .filter(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.desc())
        .first()
    )
    if msg is None:
        return ""
    return msg.content[:100] if msg.content else ""


def _conversation_response(db: Session, conv: Conversation) -> ConversationResponse:
    """Build a ConversationResponse from a Conversation ORM instance."""
    return ConversationResponse(
        id=conv.id,
        title=conv.title,
        updated_at=conv.updated_at,
        last_message_preview=_last_message_preview(db, conv.id),
        is_archived=conv.is_archived,
    )


# ---------------------------------------------------------------------------
# Conversation endpoints
# ---------------------------------------------------------------------------


@router.get("/conversations", response_model=ConversationListResponse)
async def list_conversations(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    archived: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """List conversations ordered by updated_at descending, with pagination."""
    base_query = db.query(Conversation).filter(Conversation.is_archived == archived)
    total = base_query.count()

    conversations = (
        base_query.order_by(Conversation.updated_at.desc())
        .offset((page - 1) * limit)
        .limit(limit)
        .all()
    )

    items = [_conversation_response(db, c) for c in conversations]

    return ConversationListResponse(
        items=items,
        total=total,
        page=page,
        limit=limit,
    )


@router.post("/conversations", response_model=ConversationResponse, status_code=status.HTTP_201_CREATED)
async def create_conversation(
    body: ConversationCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Create a new conversation."""
    conv = Conversation(
        id=uuid4().hex,
        title=body.title or "New Conversation",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
        is_archived=False,
    )
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return _conversation_response(db, conv)


@router.get("/conversations/{conversation_id}", response_model=ConversationResponse)
async def get_conversation(
    conversation_id: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Get a single conversation by ID."""
    conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if conv is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    return _conversation_response(db, conv)


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_200_OK)
async def delete_conversation(
    conversation_id: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Soft-delete a conversation by setting is_archived=True."""
    conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if conv is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    conv.is_archived = True
    db.commit()
    return {"detail": "Conversation archived"}


# ---------------------------------------------------------------------------
# Message endpoints
# ---------------------------------------------------------------------------


@router.get("/conversations/{conversation_id}/messages", response_model=MessageListResponse)
async def list_messages(
    conversation_id: str,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """List messages for a conversation, ordered by created_at descending, with pagination."""
    conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if conv is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")

    base_query = db.query(Message).filter(Message.conversation_id == conversation_id)
    total = base_query.count()

    messages = (
        base_query.order_by(Message.created_at.desc())
        .offset((page - 1) * limit)
        .limit(limit)
        .all()
    )

    items = [MessageResponse.model_validate(m) for m in messages]

    return MessageListResponse(
        items=items,
        total=total,
        page=page,
        limit=limit,
    )


@router.post("/send", response_model=SendMessageResponse, status_code=status.HTTP_201_CREATED)
async def send_message(
    body: SendMessageRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Send a message (Phase 1: echo mode)."""
    conv = db.query(Conversation).filter(Conversation.id == body.conversation_id).first()
    if conv is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")

    now = datetime.now(timezone.utc)

    user_msg = Message(
        id=uuid4().hex,
        conversation_id=body.conversation_id,
        role="user",
        content=body.content,
        message_type="text",
        created_at=now,
    )
    db.add(user_msg)

    assistant_msg = Message(
        id=uuid4().hex,
        conversation_id=body.conversation_id,
        role="assistant",
        content=f"Echo: {body.content}",
        message_type="text",
        created_at=now,
    )
    db.add(assistant_msg)

    conv.updated_at = now
    db.commit()

    return SendMessageResponse(
        message_id=assistant_msg.id,
        conversation_id=body.conversation_id,
        status="delivered",
    )


@router.delete(
    "/conversations/{conversation_id}/messages/{message_id}",
    status_code=status.HTTP_200_OK,
)
async def delete_message(
    conversation_id: str,
    message_id: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Delete a specific message from a conversation."""
    conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if conv is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")

    msg = (
        db.query(Message)
        .filter(Message.id == message_id, Message.conversation_id == conversation_id)
        .first()
    )
    if msg is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")

    db.delete(msg)
    db.commit()
    return {"detail": "Message deleted"}


@router.put(
    "/conversations/{conversation_id}/messages/{message_id}",
    response_model=MessageResponse,
)
async def edit_message(
    conversation_id: str,
    message_id: str,
    body: MessageEditRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Edit the content of a specific message."""
    conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if conv is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")

    msg = (
        db.query(Message)
        .filter(Message.id == message_id, Message.conversation_id == conversation_id)
        .first()
    )
    if msg is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")

    msg.content = body.content
    conv.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(msg)

    return MessageResponse.model_validate(msg)


# ---------------------------------------------------------------------------
# Streaming endpoint
# ---------------------------------------------------------------------------


def _generate_simulated_response(user_content: str) -> str:
    """Generate a simulated LLM response. Will be replaced by actual LLM call."""
    return (
        f"I received your message: \"{user_content}\". "
        "This is a simulated streaming response from OpenClaw. "
        "In the future, this will be powered by a real language model "
        "that can help you manage tasks, answer questions, and much more."
    )


async def _stream_tokens(
    conversation_id: str,
    user_content: str,
    assistant_message_id: str,
    db: Session,
    request: Request,
):
    """Async generator that yields SSE-formatted token events."""
    meta = json.dumps({
        "conversation_id": conversation_id,
        "message_id": assistant_message_id,
    })
    yield f"data: {meta}\n\n"

    response_text = _generate_simulated_response(user_content)
    words = response_text.split(" ")
    accumulated = ""

    for i, word in enumerate(words):
        if await request.is_disconnected():
            break

        token = word if i == 0 else f" {word}"
        accumulated += token

        token_event = json.dumps({"token": token})
        yield f"data: {token_event}\n\n"

        await asyncio.sleep(0.05)

    try:
        assistant_msg = db.query(Message).filter(Message.id == assistant_message_id).first()
        if assistant_msg:
            assistant_msg.content = accumulated
        conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
        if conv:
            conv.updated_at = datetime.now(timezone.utc)
        db.commit()
    except Exception:
        db.rollback()

    yield "data: [DONE]\n\n"


@router.post("/stream")
async def stream_message(
    body: StreamSendRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Send a message and stream the assistant response via SSE."""
    conv = db.query(Conversation).filter(Conversation.id == body.conversation_id).first()
    if conv is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found",
        )

    now = datetime.now(timezone.utc)

    user_msg = Message(
        id=uuid4().hex,
        conversation_id=body.conversation_id,
        role="user",
        content=body.content,
        message_type="text",
        created_at=now,
    )
    db.add(user_msg)

    assistant_msg = Message(
        id=uuid4().hex,
        conversation_id=body.conversation_id,
        role="assistant",
        content="",
        message_type="text",
        created_at=now,
    )
    db.add(assistant_msg)

    conv.updated_at = now
    db.commit()

    return StreamingResponse(
        _stream_tokens(
            conversation_id=body.conversation_id,
            user_content=body.content,
            assistant_message_id=assistant_msg.id,
            db=db,
            request=request,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
