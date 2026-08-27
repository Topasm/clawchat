"""Prompt context capture and strict LLM parsing for task plan proposals."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

from config import settings
from domain.task import TaskStatus
from models.event import Event
from models.todo import Todo
from schemas.task import PlanPayload
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from services.ai_service import AIService
from services.obsidian_context_service import read_project_context
from services.plan_validation_service import parse_plan_response

logger = logging.getLogger(__name__)

PROMPT_VERSION = "task-plan-v2"

_SYSTEM_PROMPT = """\
You are a task planner for a personal assistant. Given a task and its context, create a structured plan with subtasks.

Rules:
- Break the task into concrete, actionable subtasks
- Estimate time in minutes for each subtask (between 1 and 10080)
- Suggest due dates as exact YYYY-MM-DD values considering the existing schedule
- Identify dependencies between subtasks using zero-based indices
- Never add self, duplicate, dangling, or cyclic dependencies
- If a project title is appropriate and none exists, suggest one
- Return between 1 and 50 subtasks

Return ONLY a JSON object with exactly this structure:
{
  "summary": "Brief plan description",
  "suggested_root_due_date": "YYYY-MM-DD or null",
  "suggested_skills": ["plan", "research", "draft", "data_analysis", "code_review", "summarize", "obsidian_sync", "prioritize"],
  "suggested_assignee": null,
  "suggested_project_title": "string or null",
  "subtasks": [
    {
      "title": "Subtask title",
      "description": "Optional description or null",
      "estimated_minutes": 30,
      "due_date": "YYYY-MM-DD or null",
      "priority": "low | medium | high | urgent",
      "depends_on_indices": [0]
    }
  ]
}"""


@dataclass(frozen=True)
class PlanningContext:
    todo_id: str
    title: str
    description: str | None
    root_due_date: date | None
    source_id: str | None
    additional_instructions: str | None
    clarification_lines: tuple[str, ...] = ()
    child_titles: tuple[str, ...] = ()
    upcoming_event_lines: tuple[str, ...] = ()
    upcoming_todo_lines: tuple[str, ...] = ()

    def canonical_dict(self) -> dict[str, object]:
        return {
            "todo_id": self.todo_id,
            "title": self.title,
            "description": self.description,
            "root_due_date": (
                self.root_due_date.isoformat() if self.root_due_date else None
            ),
            "source_id": self.source_id,
            "additional_instructions": self.additional_instructions,
            "clarification_lines": list(self.clarification_lines),
            "child_titles": list(self.child_titles),
            "upcoming_event_lines": list(self.upcoming_event_lines),
            "upcoming_todo_lines": list(self.upcoming_todo_lines),
        }


@dataclass(frozen=True)
class ExternalPlanningContext:
    todo_md: str = ""
    related_document_lines: tuple[str, ...] = field(default_factory=tuple)

    def canonical_dict(self) -> dict[str, object]:
        return {
            "todo_md": self.todo_md,
            "related_document_lines": list(self.related_document_lines),
        }


async def capture_planning_context(
    db: AsyncSession,
    todo: Todo,
    *,
    additional_instructions: str | None = None,
) -> PlanningContext:
    """Capture all database-backed prompt inputs into a detached value object."""
    now = datetime.now(timezone.utc)
    seven_days = now + timedelta(days=7)

    child_todos = list(
        (
            await db.execute(
                select(Todo)
                .where(Todo.parent_id == todo.id)
                .order_by(Todo.sort_order, Todo.id)
                .execution_options(populate_existing=True)
            )
        )
        .scalars()
        .all()
    )
    upcoming_events = list(
        (
            await db.execute(
                select(Event)
                .where(
                    Event.start_time >= now,
                    Event.start_time <= seven_days,
                )
                .order_by(Event.start_time, Event.id)
                .execution_options(populate_existing=True)
            )
        )
        .scalars()
        .all()
    )
    upcoming_todos = list(
        (
            await db.execute(
                select(Todo)
                .where(
                    Todo.due_date >= now,
                    Todo.due_date <= seven_days,
                    Todo.status != TaskStatus.COMPLETED,
                )
                .order_by(Todo.due_date, Todo.id)
                .execution_options(populate_existing=True)
            )
        )
        .scalars()
        .all()
    )

    clarification_lines: list[str] = []
    if todo.clarification_questions and todo.clarification_answers:
        try:
            questions = json.loads(todo.clarification_questions)
            answers = json.loads(todo.clarification_answers)
            for index, question in enumerate(questions):
                answer = answers.get(str(index))
                if answer:
                    clarification_lines.append(f"Q: {question}\nA: {answer}")
        except (json.JSONDecodeError, TypeError, AttributeError):
            logger.debug("Failed to parse clarification Q&A for todo=%s", todo.id)

    return PlanningContext(
        todo_id=todo.id,
        title=todo.title,
        description=todo.description,
        root_due_date=todo.due_date.date() if todo.due_date else None,
        source_id=todo.source_id,
        additional_instructions=(
            additional_instructions.strip()
            if additional_instructions and additional_instructions.strip()
            else None
        ),
        clarification_lines=tuple(clarification_lines),
        child_titles=tuple(child.title for child in child_todos),
        upcoming_event_lines=tuple(
            f"{event.title} ({event.start_time.strftime('%a %m/%d %H:%M')})"
            for event in upcoming_events
        ),
        upcoming_todo_lines=tuple(
            f"{item.title} (due {item.due_date.strftime('%a %m/%d')})"
            for item in upcoming_todos
            if item.due_date
        ),
    )


def read_external_planning_context(context: PlanningContext) -> ExternalPlanningContext:
    """Read Vault context only after the caller has ended its DB transaction."""
    if not context.source_id or not settings.obsidian_vault_path:
        return ExternalPlanningContext()
    try:
        project_context = read_project_context(
            settings.obsidian_vault_path,
            context.source_id,
            settings.obsidian_cli_command,
        )
    except Exception:
        logger.warning(
            "Failed to read Obsidian context for source_id=%s",
            context.source_id,
            exc_info=True,
        )
        return ExternalPlanningContext()
    related_documents = project_context.get("related_docs", [])
    return ExternalPlanningContext(
        todo_md=str(project_context.get("todo_md", "")),
        related_document_lines=tuple(
            f"{document.get('name', 'Document')}: {str(document.get('content', ''))[:200]}"
            for document in related_documents
            if isinstance(document, dict)
        ),
    )


async def generate_plan(
    ai_service: AIService,
    context: PlanningContext,
    external_context: ExternalPlanningContext,
) -> PlanPayload:
    """Call the model and reject malformed output instead of returning fallback data."""
    raw_response = await ai_service.generate_completion(
        _SYSTEM_PROMPT,
        build_user_message(context, external_context),
    )
    return parse_plan_response(raw_response)


def build_user_message(
    context: PlanningContext,
    external_context: ExternalPlanningContext,
) -> str:
    parts = [f"Task: {context.title}"]
    if context.description:
        parts.append(f"Description: {context.description}")
    if context.additional_instructions:
        parts.append(f"User planning guidance:\n{context.additional_instructions}")
    if context.clarification_lines:
        parts.append(
            "Additional context from user Q&A:\n"
            + "\n".join(context.clarification_lines)
        )
    if context.child_titles:
        parts.append(
            "Existing subtasks:\n"
            + "\n".join(f"- {title}" for title in context.child_titles)
        )
    if external_context.todo_md:
        parts.append(f"Project TODO.md:\n{external_context.todo_md}")
    if external_context.related_document_lines:
        parts.append(
            "Related docs:\n"
            + "\n".join(f"- {line}" for line in external_context.related_document_lines)
        )
    events = "\n".join(f"- {line}" for line in context.upcoming_event_lines) or "None"
    todos = "\n".join(f"- {line}" for line in context.upcoming_todo_lines) or "None"
    parts.append(f"Schedule (next 7 days):\nEvents: {events}\nUpcoming tasks: {todos}")
    return "\n\n".join(parts)
