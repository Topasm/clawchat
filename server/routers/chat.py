import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request

logger = logging.getLogger(__name__)
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import noload
from starlette.responses import StreamingResponse

from auth.dependencies import get_current_user
from constants import SYSTEM_PROMPT
from database import get_db
from exceptions import NotFoundError
from models.conversation import Conversation
from models.message import Message
from models.project import Project
from models.todo import Todo
from schemas.chat import (
    ConversationDetailResponse,
    ConversationResponse,
    CreateConversationRequest,
    MessageEditRequest,
    MessageResponse,
    SendMessageRequest,
    SendMessageResponse,
)
from schemas.common import PaginatedResponse
from services.chat.conversation_context import (
    build_first_class_project_context,
    build_project_context,
)
from services.chat.intent_classifier import classify_intent
from utils import make_id

router = APIRouter()


async def _record_user_message(
    db: AsyncSession,
    body: SendMessageRequest,
) -> tuple[Message, bool]:
    """Persist the inbound user message, collapsing retries of the same send.

    Returns ``(message, is_replay)``. When the client resends with a key we have
    already stored -- which happens whenever a request fails after the server
    committed -- the stored message is returned untouched instead of a duplicate.
    """
    if body.idempotency_key:
        existing = (
            await db.execute(
                select(Message).where(
                    Message.conversation_id == body.conversation_id,
                    Message.idempotency_key == body.idempotency_key,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            return existing, True

    message = Message(
        id=make_id("msg_"),
        conversation_id=body.conversation_id,
        role="user",
        content=body.content,
        idempotency_key=body.idempotency_key,
    )
    db.add(message)
    conv = await db.get(Conversation, body.conversation_id)
    if conv:
        conv.updated_at = datetime.now(timezone.utc)
    try:
        await db.commit()
    except IntegrityError:
        # Two retries raced. The winner's row is the one that counts.
        await db.rollback()
        existing = (
            await db.execute(
                select(Message).where(
                    Message.conversation_id == body.conversation_id,
                    Message.idempotency_key == body.idempotency_key,
                )
            )
        ).scalar_one_or_none()
        if existing is None:
            raise
        return existing, True
    return message, False


@router.get("/conversations", response_model=PaginatedResponse[ConversationResponse])
async def list_conversations(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    archived: bool = False,
    project_id: str | None = None,
    project_todo_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    offset = (page - 1) * limit

    conditions = [Conversation.is_archived == archived]
    if project_todo_id is not None:
        conditions.append(Conversation.project_todo_id == project_todo_id)
    if project_id is not None:
        conditions.append(Conversation.project_id == project_id)

    count_q = select(func.count(Conversation.id)).where(*conditions)
    total = (await db.execute(count_q)).scalar() or 0

    last_message_subquery = (
        select(Message.content)
        .where(Message.conversation_id == Conversation.id)
        .order_by(Message.created_at.desc())
        .limit(1)
        .correlate(Conversation)
        .scalar_subquery()
    )
    q = (
        select(Conversation, last_message_subquery.label("last_message"))
        .options(noload(Conversation.messages))
        .where(*conditions)
        .order_by(Conversation.updated_at.desc())
        .offset(offset)
        .limit(limit)
    )
    rows = (await db.execute(q)).all()

    items = []
    for conv, last_msg in rows:
        preview = last_msg[:100] if last_msg else None

        items.append(
            ConversationResponse(
                id=conv.id,
                title=conv.title,
                created_at=conv.created_at,
                updated_at=conv.updated_at,
                is_archived=conv.is_archived,
                last_message=preview,
                project_id=conv.project_id,
                project_todo_id=conv.project_todo_id,
            )
        )

    return PaginatedResponse(items=items, total=total, page=page, limit=limit)


@router.post("/conversations", response_model=ConversationResponse, status_code=201)
async def create_conversation(
    body: CreateConversationRequest,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    project_id = body.project_id
    project_todo_id = body.project_todo_id
    if project_id is not None:
        project = await db.get(Project, project_id)
        if project is None:
            raise NotFoundError("Project not found")
        project_todo_id = project.root_task_id
    elif project_todo_id is not None:
        root = await db.get(Todo, project_todo_id)
        if root is None:
            raise NotFoundError("Project todo not found")
        project_id = root.project_id
    conv = Conversation(
        title=body.title,
        project_id=project_id,
        project_todo_id=project_todo_id,
    )
    db.add(conv)
    await db.commit()
    await db.refresh(conv)
    return ConversationResponse(
        id=conv.id,
        title=conv.title,
        created_at=conv.created_at,
        updated_at=conv.updated_at,
        is_archived=conv.is_archived,
        project_id=conv.project_id,
        project_todo_id=conv.project_todo_id,
    )


@router.get("/conversations/by-project/{todo_id}", response_model=ConversationResponse)
async def get_or_create_project_conversation(
    todo_id: str,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """Get (or create) the conversation for a project todo."""
    # Check if project todo exists
    project = await db.get(Todo, todo_id)
    if not project:
        raise NotFoundError("Project todo not found")

    # Look for existing conversation
    q = select(Conversation).where(
        Conversation.project_todo_id == todo_id,
        Conversation.is_archived == False,  # noqa: E712
    )
    conv = (await db.execute(q)).scalars().first()

    if not conv:
        conv = Conversation(
            title=project.title,
            project_id=project.project_id,
            project_todo_id=todo_id,
        )
        db.add(conv)
        await db.commit()
        await db.refresh(conv)

    return ConversationResponse(
        id=conv.id,
        title=conv.title,
        created_at=conv.created_at,
        updated_at=conv.updated_at,
        is_archived=conv.is_archived,
        project_id=conv.project_id,
        project_todo_id=conv.project_todo_id,
    )


@router.get("/conversations/{conversation_id}", response_model=ConversationDetailResponse)
async def get_conversation(
    conversation_id: str,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    conv = await db.get(Conversation, conversation_id)
    if not conv:
        raise NotFoundError("Conversation not found")

    msg_q = (
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc())
    )
    messages = (await db.execute(msg_q)).scalars().all()

    return ConversationDetailResponse(
        id=conv.id,
        title=conv.title,
        created_at=conv.created_at,
        updated_at=conv.updated_at,
        is_archived=conv.is_archived,
        project_id=conv.project_id,
        project_todo_id=conv.project_todo_id,
        messages=[MessageResponse.model_validate(m) for m in messages],
    )


@router.delete("/conversations/{conversation_id}")
async def archive_conversation(
    conversation_id: str,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    conv = await db.get(Conversation, conversation_id)
    if not conv:
        raise NotFoundError("Conversation not found")
    conv.is_archived = True
    conv.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return {"message": "Conversation archived"}


@router.post("/stream")
async def stream_chat(
    body: SendMessageRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    conv = await db.get(Conversation, body.conversation_id)
    if not conv:
        raise NotFoundError("Conversation not found")

    user_msg, _replayed = await _record_user_message(db, body)

    # Build message history (last 20)
    q = (
        select(Message)
        .where(Message.conversation_id == body.conversation_id)
        .order_by(Message.created_at.desc())
        .limit(20)
    )
    rows = (await db.execute(q)).scalars().all()
    history = list(reversed(rows))

    system_content = SYSTEM_PROMPT
    if conv.project_id:
        system_content += await build_first_class_project_context(db, conv.project_id)
    elif conv.project_todo_id:
        system_content += await build_project_context(db, conv.project_todo_id)
    messages = [{"role": "system", "content": system_content}]
    for msg in history:
        messages.append({"role": msg.role, "content": msg.content})

    assistant_msg_id = make_id("msg_")
    ai_service = getattr(request.app.state, "active_ai", request.app.state.ai_service)
    session_factory = request.app.state.session_factory
    orchestrator = getattr(request.app.state, "orchestrator", None)
    user_msg_id = user_msg.id

    async def event_generator():
        meta = json.dumps(
            {
                "conversation_id": body.conversation_id,
                "message_id": assistant_msg_id,
                "user_message_id": user_msg_id,
            }
        )
        yield f"data: {meta}\n\n"

        accumulated = ""
        resolved_intent = "general_chat"
        action_metadata = None

        # Classify first: without this, an SSE client could only ever chat.
        # Task and calendar requests silently produced prose instead of doing
        # anything, which is what every Android client experienced.
        action_text = None
        if orchestrator is not None:
            try:
                async with session_factory() as intent_db:
                    intent_result = await classify_intent(body.content, ai_service)
                    resolved_intent = intent_result.intent
                    resolved = await orchestrator.resolve_intent_response(
                        intent_db,
                        body.conversation_id,
                        intent_result.intent,
                        intent_result.params,
                        body.content,
                    )
                    if resolved is not None:
                        action_text, action_metadata = resolved
                    intent_user_msg = await intent_db.get(Message, user_msg_id)
                    if intent_user_msg:
                        intent_user_msg.intent = resolved_intent
                    await intent_db.commit()
            except Exception:
                logger.exception("Intent handling failed; falling back to chat")
                action_text = None
                resolved_intent = "general_chat"

        if action_text is not None:
            accumulated = action_text
            yield f"data: {json.dumps({'token': action_text})}\n\n"
            if action_metadata:
                yield f"data: {json.dumps({'module_data_changed': action_metadata})}\n\n"
        else:
            try:
                async for token in ai_service.stream_completion(messages):
                    accumulated += token
                    yield f"data: {json.dumps({'token': token})}\n\n"
            except Exception as exc:
                logger.exception("Chat stream error: %s", exc)
                if not accumulated:
                    error_text = f"Sorry, an error occurred while generating a response: {exc}"
                    accumulated = error_text
                    yield f"data: {json.dumps({'token': error_text})}\n\n"

        # Save assistant message with a fresh session
        async with session_factory() as save_db:
            assistant_msg = Message(
                id=assistant_msg_id,
                conversation_id=body.conversation_id,
                role="assistant",
                content=accumulated,
                intent=resolved_intent,
                metadata_json=json.dumps(action_metadata) if action_metadata else None,
            )
            save_db.add(assistant_msg)
            save_conv = await save_db.get(Conversation, body.conversation_id)
            if save_conv:
                save_conv.updated_at = datetime.now(timezone.utc)
                # Auto-generate title on first message
                if not save_conv.title:
                    try:
                        title = await ai_service.generate_title(body.content)
                        save_conv.title = title
                        yield f"data: {json.dumps({'title_generated': title})}\n\n"
                    except Exception:
                        pass
            await save_db.commit()

        # [DONE] must be last: every client stops reading here, so anything
        # emitted after it -- the generated title, previously -- never arrived.
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/send", response_model=SendMessageResponse, status_code=202)
async def send_message(
    body: SendMessageRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    conv = await db.get(Conversation, body.conversation_id)
    if not conv:
        raise NotFoundError("Conversation not found")

    msg, replayed = await _record_user_message(db, body)

    # A replay is a retry of a send we already accepted; dispatching again would
    # run the orchestrator twice over the same message.
    if not replayed:
        orchestrator = request.app.state.orchestrator
        background_tasks.add_task(
            orchestrator.handle_message,
            user_id=_user,
            conversation_id=body.conversation_id,
            message_id=msg.id,
            content=body.content,
        )

    return SendMessageResponse(
        message_id=msg.id,
        conversation_id=body.conversation_id,
    )


@router.get(
    "/conversations/{conversation_id}/messages",
    response_model=PaginatedResponse[MessageResponse],
)
async def list_messages(
    conversation_id: str,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    conv = await db.get(Conversation, conversation_id)
    if not conv:
        raise NotFoundError("Conversation not found")

    offset = (page - 1) * limit
    count_q = select(func.count(Message.id)).where(
        Message.conversation_id == conversation_id
    )
    total = (await db.execute(count_q)).scalar() or 0

    q = (
        select(Message)
        .where(Message.conversation_id == conversation_id)
        # Page one is the most recent page.  Ordering ascending here returned
        # the *oldest* 50 rows forever, which made new chat history appear to
        # vanish as soon as a conversation crossed the page limit.
        .order_by(Message.created_at.desc(), Message.id.desc())
        .offset(offset)
        .limit(limit)
    )
    rows = (await db.execute(q)).scalars().all()

    return PaginatedResponse(
        items=[MessageResponse.model_validate(m) for m in rows],
        total=total,
        page=page,
        limit=limit,
    )


@router.delete("/conversations/{conversation_id}/messages/{message_id}")
async def delete_message(
    conversation_id: str,
    message_id: str,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    conv = await db.get(Conversation, conversation_id)
    if not conv:
        raise NotFoundError("Conversation not found")

    msg = await db.get(Message, message_id)
    if not msg or msg.conversation_id != conversation_id:
        raise NotFoundError("Message not found")

    await db.delete(msg)
    await db.commit()
    return {"message": "Message deleted"}


@router.put(
    "/conversations/{conversation_id}/messages/{message_id}",
    response_model=MessageResponse,
)
async def edit_message(
    conversation_id: str,
    message_id: str,
    body: MessageEditRequest,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    conv = await db.get(Conversation, conversation_id)
    if not conv:
        raise NotFoundError("Conversation not found")

    msg = await db.get(Message, message_id)
    if not msg or msg.conversation_id != conversation_id:
        raise NotFoundError("Message not found")

    msg.content = body.content
    conv.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(msg)
    return MessageResponse.model_validate(msg)
