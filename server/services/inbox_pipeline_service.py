"""Inbox pipeline — classifies and plans newly captured todos via AI."""

import json
import logging
from dataclasses import dataclass
from datetime import datetime

from config import settings
from models.todo import Todo
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession
from utils import serialize_tags
from ws.notifications import notify_module_data_changed

from services.ai_service import AIService
from services.obsidian_context_service import list_project_folders

logger = logging.getLogger(__name__)

_STALE_CLASSIFICATION_ERROR = (
    "Classification result was discarded because the todo changed while the AI "
    "was running"
)


@dataclass(frozen=True)
class _ClassificationSnapshot:
    """Immutable input and optimistic-concurrency token for classification."""

    id: str
    title: str
    description: str | None
    priority: str
    tags: str | None
    source: str | None
    source_id: str | None
    updated_at: datetime

    @classmethod
    def capture(cls, todo: Todo) -> "_ClassificationSnapshot":
        return cls(
            id=todo.id,
            title=todo.title,
            description=todo.description,
            priority=todo.priority,
            tags=todo.tags,
            source=todo.source,
            source_id=todo.source_id,
            updated_at=todo.updated_at,
        )


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


async def process_todo(db: AsyncSession, ai_service: AIService, todo_id: str) -> None:
    """Run the inbox classification and optional planning pipeline for a todo."""
    todo = await db.get(Todo, todo_id)
    if not todo:
        logger.warning("process_todo called with unknown todo_id=%s", todo_id)
        return

    try:
        # Step 1 — classify
        todo.inbox_state = "classifying"
        await db.commit()
        todo = await db.get(Todo, todo_id, populate_existing=True)
        if todo is None:
            return

        snapshot = _ClassificationSnapshot.capture(todo)
        classification = await _classify_todo(ai_service, todo)
        updates, next_state = _classification_updates(snapshot, classification)

        # This must be the first database write after the classifier returns.
        # Updating the Todo and checking its snapshot in one statement closes the
        # SELECT-then-write race without rejecting edits to unrelated Todos.
        claimed_todo_id = (
            await db.execute(
                update(Todo)
                .where(
                    Todo.id == snapshot.id,
                    Todo.updated_at == snapshot.updated_at,
                    Todo.inbox_state == "classifying",
                    Todo.title == snapshot.title,
                    Todo.description == snapshot.description,
                    Todo.priority == snapshot.priority,
                    Todo.tags == snapshot.tags,
                    Todo.source == snapshot.source,
                    Todo.source_id == snapshot.source_id,
                )
                .values(**updates)
                .returning(Todo.id)
                .execution_options(synchronize_session=False)
            )
        ).scalar_one_or_none()
        if claimed_todo_id is None:
            await _mark_classification_stale(db, todo_id)
            return

        await db.commit()
        todo = await db.get(Todo, todo_id, populate_existing=True)
        if todo is None:
            return
        await notify_module_data_changed("todos")

        # Step 5 — questioning, planning, or captured
        if next_state == "questioning":
            await _generate_clarification_questions(db, ai_service, todo)
        elif next_state == "planning":
            await _trigger_planning(db, ai_service, todo)

    except Exception as exc:
        logger.exception("Inbox pipeline failed for todo %s", todo_id)
        await _record_pipeline_error(db, todo_id, exc)


# ---------------------------------------------------------------------------
# Resume pipeline after user answers clarification questions
# ---------------------------------------------------------------------------


async def resume_after_answers(
    db: AsyncSession, ai_service: AIService, todo_id: str
) -> None:
    """Transition a todo from questioning to planning, using Q&A context."""
    todo = await db.get(Todo, todo_id)
    if not todo:
        logger.warning("resume_after_answers called with unknown todo_id=%s", todo_id)
        return

    try:
        todo.inbox_state = "planning"
        await db.commit()
        await notify_module_data_changed("todos")
        await _trigger_planning(db, ai_service, todo)
    except Exception as exc:
        logger.exception("Planning after answers failed for todo %s", todo_id)
        await _record_pipeline_error(db, todo_id, exc)


def _classification_updates(
    snapshot: _ClassificationSnapshot,
    classification: dict,
) -> tuple[dict[str, object], str]:
    """Build the complete classifier patch without mutating its ORM snapshot."""
    priority = classification.get("priority") or snapshot.priority

    tags = snapshot.tags
    new_tags = classification.get("tags") or []
    if new_tags:
        existing: list[str] = []
        if snapshot.tags:
            try:
                parsed = json.loads(snapshot.tags)
                if isinstance(parsed, list):
                    existing = parsed
            except (json.JSONDecodeError, TypeError):
                pass
        merged = list(dict.fromkeys(existing + new_tags))
        tags = serialize_tags(merged)

    source = snapshot.source
    source_id = snapshot.source_id
    matched_folder = classification.get("matched_project_folder")
    confidence = classification.get("project_confidence", 0)
    if matched_folder and confidence >= 0.8:
        source = "obsidian_project"
        source_id = matched_folder

    next_state = "captured"
    if classification.get("needs_planning"):
        task_text = f"{snapshot.title or ''} {snapshot.description or ''}"
        next_state = "questioning" if len(task_text.split()) < 30 else "planning"

    return (
        {
            "priority": priority,
            "tags": tags,
            "source": source,
            "source_id": source_id,
            "inbox_state": next_state,
            "automation_error": None,
        },
        next_state,
    )


async def _mark_classification_stale(db: AsyncSession, todo_id: str) -> None:
    """Discard a stale classifier result without writing any semantic fields."""
    await db.rollback()
    result = await db.execute(
        update(Todo)
        .where(Todo.id == todo_id, Todo.inbox_state == "classifying")
        .values(
            inbox_state="error",
            automation_error=_STALE_CLASSIFICATION_ERROR,
        )
        .execution_options(synchronize_session=False)
    )
    await db.commit()
    logger.info("%s for todo %s", _STALE_CLASSIFICATION_ERROR, todo_id)
    if result.rowcount:
        await notify_module_data_changed("todos")


async def _record_pipeline_error(
    db: AsyncSession,
    todo_id: str,
    exc: Exception,
) -> None:
    """Recover the transaction, then record an error without a stale ORM write."""
    await db.rollback()
    try:
        result = await db.execute(
            update(Todo)
            .where(Todo.id == todo_id)
            .values(inbox_state="error", automation_error=str(exc))
            .execution_options(synchronize_session=False)
        )
        await db.commit()
    except Exception:
        await db.rollback()
        logger.exception("Failed to persist inbox pipeline error for todo %s", todo_id)
        return
    if result.rowcount:
        await notify_module_data_changed("todos")


# ---------------------------------------------------------------------------
# Clarification question generation
# ---------------------------------------------------------------------------

_QUESTION_SYSTEM_PROMPT = (
    "You are a task planning assistant. Given a task title, generate 3-5 short "
    "clarifying questions that would help decompose this into specific subtasks. "
    'Return ONLY a JSON array of strings, e.g. ["Question 1?", "Question 2?"].'
)
_DEFAULT_CLARIFICATION_QUESTIONS = [
    "What is the desired outcome or goal?",
    "What are the key steps involved?",
    "Are there any deadlines or time constraints?",
]


async def _generate_clarification_questions(
    db: AsyncSession, ai_service: AIService, todo: Todo
) -> None:
    """Generate clarifying questions via LLM and save them on the todo."""
    task_text = todo.title
    if todo.description:
        task_text += f"\nDescription: {todo.description}"

    try:
        raw_response = await ai_service.generate_completion(
            _QUESTION_SYSTEM_PROMPT,
            f"Task: {task_text}",
        )
        from utils import strip_markdown_fences

        cleaned = strip_markdown_fences(raw_response)
        questions = json.loads(cleaned)

        if not isinstance(questions, list) or not questions:
            questions = list(_DEFAULT_CLARIFICATION_QUESTIONS)

    except Exception:
        logger.exception(
            "Failed to generate clarification questions for todo %s", todo.id
        )
        questions = list(_DEFAULT_CLARIFICATION_QUESTIONS)

    # Keep provider/parse fallback separate from persistence failures. A failed
    # flush or commit must be rolled back by the caller rather than attempting a
    # second commit on a PendingRollback session.
    try:
        result = await db.execute(
            update(Todo)
            .where(Todo.id == todo.id, Todo.inbox_state == "questioning")
            .values(clarification_questions=json.dumps(questions))
            .execution_options(synchronize_session=False)
        )
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    if result.rowcount:
        await notify_module_data_changed("todos")


# ---------------------------------------------------------------------------
# Classification via LLM function calling
# ---------------------------------------------------------------------------

_CLASSIFY_SYSTEM_PROMPT = (
    "You are an inbox organizer for a personal task manager. "
    "Classify the following task captured via quick capture. "
    "Determine priority, relevant tags, whether it matches a known project, "
    "and whether it needs planning (breaking down into subtasks)."
)

_CLASSIFY_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "classify_todo",
            "description": "Classify an inbox todo item",
            "parameters": {
                "type": "object",
                "properties": {
                    "priority": {
                        "type": "string",
                        "enum": ["low", "medium", "high", "urgent"],
                    },
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Relevant tags",
                    },
                    "matched_project_folder": {
                        "type": "string",
                        "description": "Vault-relative folder path if matches a project",
                    },
                    "project_confidence": {
                        "type": "number",
                        "description": "0-1 confidence in project match",
                    },
                    "suggested_project_title": {
                        "type": "string",
                        "description": "If no match, suggest a project title",
                    },
                    "needs_planning": {
                        "type": "boolean",
                        "description": "True if task needs subtask breakdown",
                    },
                    "suggested_skills": {
                        "type": "array",
                        "items": {
                            "type": "string",
                            "enum": [
                                "plan",
                                "research",
                                "summarize",
                                "draft",
                                "code_review",
                                "data_analysis",
                                "obsidian_sync",
                                "prioritize",
                            ],
                        },
                        "description": "Relevant skills for this task",
                    },
                },
                "required": ["priority", "tags", "needs_planning"],
            },
        },
    }
]

_CLASSIFY_DEFAULTS: dict = {"priority": "medium", "tags": [], "needs_planning": False}


async def _classify_todo(ai_service: AIService, todo: Todo) -> dict:
    """Use LLM function calling to classify an inbox todo."""
    parts: list[str] = [f"Task: {todo.title}"]
    if todo.description:
        parts.append(f"Description: {todo.description}")

    # Include project folder context when an Obsidian vault is configured
    if settings.obsidian_vault_path:
        try:
            folders = list_project_folders(settings.obsidian_vault_path)
            if folders:
                parts.append(f"Known project folders: {', '.join(folders)}")
        except Exception:  # noqa: BLE001 - optional vault context must not block capture
            logger.debug("Could not list Obsidian project folders")

    user_message = "\n".join(parts)

    try:
        response = await ai_service.function_call(
            system_prompt=_CLASSIFY_SYSTEM_PROMPT,
            user_message=user_message,
            tools=_CLASSIFY_TOOLS,
            tool_choice={"type": "function", "function": {"name": "classify_todo"}},
        )

        choices = response.get("choices", [])
        if not choices:
            return dict(_CLASSIFY_DEFAULTS)

        msg = choices[0].get("message", {})
        tool_calls = msg.get("tool_calls", [])
        if not tool_calls:
            return dict(_CLASSIFY_DEFAULTS)

        args_str = tool_calls[0]["function"]["arguments"]
        return json.loads(args_str)

    except Exception:
        logger.exception("Todo classification failed, returning defaults")
        return dict(_CLASSIFY_DEFAULTS)


# ---------------------------------------------------------------------------
# Planning trigger
# ---------------------------------------------------------------------------


async def _trigger_planning(
    db: AsyncSession, ai_service: AIService, todo: Todo
) -> None:
    """Generate through the same canonical proposal service as the public API."""
    from services import plan_proposal_service

    await plan_proposal_service.generate_proposal(
        db,
        ai_service,
        todo.id,
        model_provider=settings.ai_provider,
    )
    await notify_module_data_changed("todos")
