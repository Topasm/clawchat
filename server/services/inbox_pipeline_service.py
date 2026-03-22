"""Inbox pipeline — classifies and plans newly captured todos via AI."""

import json
import logging
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from models.todo import Todo
from models.agent_task import AgentTask
from services.ai_service import AIService
from services.obsidian_context_service import list_project_folders, resolve_project_folder
from config import settings
from utils import make_id, serialize_tags

logger = logging.getLogger(__name__)

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

        classification = await _classify_todo(ai_service, todo)

        # Step 2 — auto-apply priority
        if classification.get("priority"):
            todo.priority = classification["priority"]

        # Step 3 — merge tags
        new_tags = classification.get("tags") or []
        if new_tags:
            existing_raw = todo.tags
            existing: list[str] = []
            if existing_raw:
                try:
                    existing = json.loads(existing_raw)
                except (json.JSONDecodeError, TypeError):
                    existing = []
            merged = list(dict.fromkeys(existing + new_tags))  # dedupe, preserve order
            todo.tags = serialize_tags(merged)

        # Step 4 — matched project folder
        matched_folder = classification.get("matched_project_folder")
        confidence = classification.get("project_confidence", 0)
        if matched_folder and confidence >= 0.8:
            todo.source = "obsidian_project"
            todo.source_id = matched_folder

        # Step 5 — planning or captured
        if classification.get("needs_planning"):
            todo.inbox_state = "planning"
            await db.commit()
            await _trigger_planning(db, ai_service, todo)
        else:
            todo.inbox_state = "captured"
            await db.commit()

    except Exception as exc:
        logger.exception("Inbox pipeline failed for todo %s", todo_id)
        todo.inbox_state = "error"
        todo.automation_error = str(exc)
        await db.commit()


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
                    "suggested_assignee": {
                        "type": "string",
                        "enum": ["planner", "researcher", "executor"],
                        "description": "Best agent persona",
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
        except Exception:
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


async def _trigger_planning(db: AsyncSession, ai_service: AIService, todo: Todo) -> None:
    """Create a planner AgentTask and generate a subtask plan for the todo."""
    agent_task = AgentTask(
        id=make_id("task_"),
        agent_type="planner",
        task_type="plan_todo",
        todo_id=todo.id,
        instruction=f"Plan subtasks for: {todo.title}",
        status="queued",
    )
    db.add(agent_task)
    await db.flush()

    try:
        from services import todo_planning_service

        result = await todo_planning_service.generate_plan(db, ai_service, todo)
        agent_task.payload_json = json.dumps(result) if not isinstance(result, str) else result
        agent_task.status = "completed"
        agent_task.completed_at = datetime.now(timezone.utc)

        todo.inbox_state = "plan_ready"
        await db.commit()

    except Exception as exc:
        logger.exception("Planning failed for todo %s", todo.id)
        agent_task.status = "failed"
        agent_task.error = str(exc)
        agent_task.completed_at = datetime.now(timezone.utc)

        todo.inbox_state = "error"
        todo.automation_error = str(exc)
        await db.commit()
