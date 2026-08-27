"""Generate strict, non-mutating Inbox placement recommendations."""

import json
from typing import Any

from domain.project import ProjectStatus
from domain.task import TaskStatus
from exceptions import AppError, ConflictError, NotFoundError, ValidationError
from models.project import Project
from models.todo import Todo
from pydantic import BaseModel
from pydantic import ValidationError as PydanticValidationError
from schemas.inbox_triage import InboxTriagePreviewResponse, InboxTriageSuggestion
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from services.graph_command_service import current_graph_revision


class _SuggestionPayload(BaseModel):
    suggestions: list[InboxTriageSuggestion]


def _generation_error(message: str) -> AppError:
    return AppError(
        code="INBOX_TRIAGE_GENERATION_FAILED",
        message=message,
        status_code=502,
    )


def _extract_arguments(response: dict[str, Any]) -> dict[str, Any]:
    try:
        arguments = response["choices"][0]["message"]["tool_calls"][0]["function"][
            "arguments"
        ]
        if isinstance(arguments, str):
            parsed = json.loads(arguments)
        else:
            parsed = arguments
        if not isinstance(parsed, dict):
            raise TypeError("tool arguments are not an object")
        return parsed
    except (IndexError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise _generation_error("AI returned an invalid Inbox triage response") from exc


async def generate_preview(
    db: AsyncSession,
    ai_service: Any,
    *,
    todo_ids: list[str],
    expected_graph_revision: int,
    model_provider: str | None,
) -> InboxTriagePreviewResponse:
    revision = await current_graph_revision(db)
    if revision != expected_graph_revision:
        raise ConflictError(
            "Task graph changed from revision "
            f"{expected_graph_revision} to {revision}; refresh and retry",
            details={
                "expected_graph_revision": expected_graph_revision,
                "current_graph_revision": revision,
            },
        )

    todos = list(
        (await db.execute(select(Todo).where(Todo.id.in_(todo_ids)))).scalars()
    )
    by_id = {todo.id: todo for todo in todos}
    missing = [todo_id for todo_id in todo_ids if todo_id not in by_id]
    if missing:
        raise NotFoundError(f"Todos not found: {', '.join(missing)}")
    ordered_todos = [by_id[todo_id] for todo_id in todo_ids]
    project_root_ids = set(
        (
            await db.execute(
                select(Project.root_task_id).where(Project.root_task_id.in_(todo_ids))
            )
        ).scalars()
    )
    if project_root_ids:
        raise ValidationError("Project roots cannot be triaged")
    terminal_ids = [
        todo.id
        for todo in ordered_todos
        if todo.status in {TaskStatus.COMPLETED, TaskStatus.CANCELLED}
    ]
    if terminal_ids:
        raise ValidationError(
            "Completed or cancelled tasks cannot be triaged",
            details={"task_ids": terminal_ids},
        )

    projects = list(
        (
            await db.execute(
                select(Project)
                .where(
                    Project.status.in_([ProjectStatus.PLANNED, ProjectStatus.ACTIVE])
                )
                .order_by(Project.updated_at.desc(), Project.id.asc())
            )
        ).scalars()
    )
    if not projects:
        raise ValidationError(
            "Create an active or planned project before using AI triage"
        )
    project_by_id = {project.id: project for project in projects}
    project_ids = list(project_by_id)
    nodes = list(
        (
            await db.execute(
                select(Todo)
                .where(
                    Todo.project_id.in_(project_ids),
                    or_(Todo.source.is_(None), Todo.source != "project_root"),
                )
                .order_by(
                    Todo.project_id.asc(), Todo.parent_id.asc(), Todo.sort_order.asc()
                )
                .limit(1000)
            )
        ).scalars()
    )
    node_by_id = {node.id: node for node in nodes}

    context = {
        "inbox_tasks": [
            {
                "id": todo.id,
                "title": todo.title,
                "description": todo.description,
                "priority": todo.priority,
            }
            for todo in ordered_todos
        ],
        "projects": [
            {
                "id": project.id,
                "title": project.title,
                "goal": project.goal,
                "description": project.description,
            }
            for project in projects
        ],
        "tree_nodes": [
            {
                "id": node.id,
                "project_id": node.project_id,
                "parent_id": node.parent_id,
                "title": node.title,
                "description": node.description,
            }
            for node in nodes
        ],
    }
    tools = [
        {
            "type": "function",
            "function": {
                "name": "propose_inbox_triage",
                "description": (
                    "Recommend existing project-tree locations for Inbox tasks"
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "suggestions": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "task_id": {"type": "string", "enum": todo_ids},
                                    "project_id": {
                                        "type": "string",
                                        "enum": project_ids,
                                    },
                                    "parent_id": {
                                        "anyOf": [
                                            {
                                                "type": "string",
                                                "enum": list(node_by_id),
                                            },
                                            {"type": "null"},
                                        ]
                                    },
                                    "confidence": {
                                        "type": "number",
                                        "minimum": 0,
                                        "maximum": 1,
                                    },
                                    "reason": {"type": "string"},
                                },
                                "required": [
                                    "task_id",
                                    "project_id",
                                    "parent_id",
                                    "confidence",
                                    "reason",
                                ],
                            },
                        }
                    },
                    "required": ["suggestions"],
                },
            },
        }
    ]
    response = await ai_service.function_call(
        system_prompt=(
            "You organize Inbox tasks into an existing project tree. Use only IDs "
            "provided in the context. parent_id=null means the project root. Return "
            "at most one suggestion per task and omit tasks when the destination is "
            "uncertain. Never invent a project or tree node."
        ),
        user_message=json.dumps(context, ensure_ascii=False, separators=(",", ":")),
        tools=tools,
        tool_choice={
            "type": "function",
            "function": {"name": "propose_inbox_triage"},
        },
    )
    try:
        payload = _SuggestionPayload.model_validate(_extract_arguments(response))
    except PydanticValidationError as exc:
        raise _generation_error("AI returned invalid Inbox triage suggestions") from exc

    allowed_tasks = set(todo_ids)
    seen_tasks: set[str] = set()
    suggestions: list[InboxTriageSuggestion] = []
    for suggestion in payload.suggestions:
        if suggestion.task_id not in allowed_tasks or suggestion.task_id in seen_tasks:
            raise _generation_error("AI returned an unknown or duplicate task")
        project = project_by_id.get(suggestion.project_id)
        if project is None:
            raise _generation_error("AI returned an unknown project")
        if suggestion.parent_id is not None:
            parent = node_by_id.get(suggestion.parent_id)
            if parent is None or parent.project_id != project.id:
                raise _generation_error(
                    "AI returned a parent outside the suggested project"
                )
        seen_tasks.add(suggestion.task_id)
        suggestions.append(suggestion)

    current = await current_graph_revision(db)
    if current != expected_graph_revision:
        raise ConflictError(
            "The task graph changed while AI triage was generated; refresh and retry",
            details={
                "expected_graph_revision": expected_graph_revision,
                "current_graph_revision": current,
            },
        )
    return InboxTriagePreviewResponse(
        base_graph_revision=expected_graph_revision,
        suggestions=suggestions,
        unassigned_task_ids=[
            todo_id for todo_id in todo_ids if todo_id not in seen_tasks
        ],
        model_provider=model_provider,
    )
