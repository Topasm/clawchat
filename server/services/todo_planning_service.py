"""Planning service — generates structured subtask proposals for a todo via LLM.

Given a root todo, this service gathers child todos, Obsidian project context,
and the user's upcoming schedule, then asks the LLM to produce a JSON plan
with concrete subtasks, time estimates, and suggested due dates.
"""

import json
import logging
from datetime import datetime, timezone, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.todo import Todo
from models.event import Event
from services.ai_service import AIService
from services.obsidian_context_service import read_project_context
from config import settings
from utils import deserialize_tags, strip_markdown_fences

logger = logging.getLogger(__name__)

_FALLBACK_PLAN: dict = {
    "summary": "Could not generate plan",
    "subtasks": [],
    "suggested_root_due_date": None,
    "suggested_skills": [],
    "suggested_assignee": None,  # legacy
    "suggested_project_title": None,
}

_SYSTEM_PROMPT = """\
You are a task planner for a personal assistant. Given a task and its context, create a structured plan with subtasks.

Rules:
- Break the task into concrete, actionable subtasks
- Estimate time in minutes for each subtask
- Suggest due dates considering the user's existing schedule
- Identify dependencies between subtasks using indices
- If a project title is appropriate and none exists, suggest one

Return ONLY a JSON object with this structure:
{
  "summary": "Brief plan description",
  "suggested_root_due_date": "YYYY-MM-DD or null",
  "suggested_skills": ["plan", "research", "draft", "data_analysis", "code_review", "summarize", "obsidian_sync", "prioritize"],
  "suggested_project_title": "string or null",
  "subtasks": [
    {
      "title": "Subtask title",
      "description": "Optional description",
      "estimated_minutes": 30,
      "due_date": "YYYY-MM-DD or null",
      "depends_on_indices": [0]
    }
  ]
}"""


async def generate_plan(
    db: AsyncSession, ai_service: AIService, todo: Todo
) -> dict:
    """Generate a structured planning proposal for *todo* using LLM + context.

    Returns a dict matching the plan JSON schema, or a minimal fallback dict
    when the LLM response cannot be parsed.
    """

    # ------------------------------------------------------------------
    # 1. Gather context
    # ------------------------------------------------------------------

    now = datetime.now(timezone.utc)
    seven_days = now + timedelta(days=7)

    # Existing child todos
    child_q = select(Todo).where(Todo.parent_id == todo.id)
    child_todos: list[Todo] = list((await db.execute(child_q)).scalars().all())

    # Obsidian project context (if applicable)
    project_context: dict | None = None
    vault_path = settings.obsidian_vault_path
    if todo.source_id and vault_path:
        try:
            project_context = read_project_context(
                vault_path, todo.source_id, settings.obsidian_cli_command
            )
        except Exception:
            logger.warning(
                "Failed to read Obsidian context for source_id=%s",
                todo.source_id,
                exc_info=True,
            )

    # Upcoming events (next 7 days)
    events_q = select(Event).where(
        Event.start_time >= now,
        Event.start_time <= seven_days,
    )
    upcoming_events: list[Event] = list(
        (await db.execute(events_q)).scalars().all()
    )

    # Upcoming todos with due dates (next 7 days, not completed)
    todos_q = select(Todo).where(
        Todo.due_date >= now,
        Todo.due_date <= seven_days,
        Todo.status != "completed",
    )
    upcoming_todos: list[Todo] = list(
        (await db.execute(todos_q)).scalars().all()
    )

    # ------------------------------------------------------------------
    # 2. Build user message
    # ------------------------------------------------------------------

    parts: list[str] = []

    # Root task
    parts.append(f"Task: {todo.title}")
    if todo.description:
        parts.append(f"Description: {todo.description}")

    # Clarification Q&A context (if user answered questions)
    if todo.clarification_questions and todo.clarification_answers:
        try:
            questions = json.loads(todo.clarification_questions)
            answers = json.loads(todo.clarification_answers)
            qa_lines: list[str] = []
            for idx, question in enumerate(questions):
                answer = answers.get(str(idx))
                if answer:
                    qa_lines.append(f"Q: {question}\nA: {answer}")
            if qa_lines:
                parts.append(f"Additional context from user Q&A:\n" + "\n".join(qa_lines))
        except (json.JSONDecodeError, TypeError):
            logger.debug("Failed to parse clarification Q&A for todo=%s", todo.id)

    # Existing subtasks
    if child_todos:
        child_lines = "\n".join(f"- {c.title}" for c in child_todos)
        parts.append(f"Existing subtasks:\n{child_lines}")

    # Project context from Obsidian
    if project_context:
        todo_md = project_context.get("todo_md", "")
        related_docs = project_context.get("related_docs", [])
        if todo_md:
            parts.append(f"Project TODO.md:\n{todo_md}")
        if related_docs:
            doc_summaries = "\n".join(
                f"- {doc['name']}: {doc['content'][:200]}"
                for doc in related_docs
            )
            parts.append(f"Related docs:\n{doc_summaries}")

    # Schedule context
    event_lines = (
        "\n".join(
            f"- {e.title} ({e.start_time.strftime('%a %m/%d %H:%M')})"
            for e in upcoming_events
        )
        or "None"
    )
    todo_lines = (
        "\n".join(
            f"- {t.title} (due {t.due_date.strftime('%a %m/%d') if t.due_date else 'N/A'})"
            for t in upcoming_todos
        )
        or "None"
    )
    parts.append(
        f"Schedule (next 7 days):\nEvents: {event_lines}\nUpcoming tasks: {todo_lines}"
    )

    user_message = "\n\n".join(parts)

    # ------------------------------------------------------------------
    # 3. Call LLM
    # ------------------------------------------------------------------

    try:
        raw_response = await ai_service.generate_completion(
            _SYSTEM_PROMPT, user_message
        )
    except Exception:
        logger.exception("LLM call failed during plan generation for todo=%s", todo.id)
        return dict(_FALLBACK_PLAN)

    # ------------------------------------------------------------------
    # 4. Parse and validate
    # ------------------------------------------------------------------

    try:
        cleaned = strip_markdown_fences(raw_response)
        plan: dict = json.loads(cleaned)
    except (json.JSONDecodeError, TypeError):
        logger.warning(
            "Failed to parse plan JSON for todo=%s: %.200s",
            todo.id,
            raw_response,
        )
        return dict(_FALLBACK_PLAN)

    # Ensure required top-level keys exist with sensible defaults.
    plan.setdefault("summary", "")
    plan.setdefault("subtasks", [])
    plan.setdefault("suggested_root_due_date", None)
    plan.setdefault("suggested_skills", [])
    plan.setdefault("suggested_assignee", None)  # legacy
    plan.setdefault("suggested_project_title", None)

    return plan
