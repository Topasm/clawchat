"""Async service layer for todo CRUD operations."""

import asyncio
import json
import logging
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from domain.task import TaskStatus
from exceptions import NotFoundError, ValidationError
from models.project import Project
from models.todo import Todo
from services.obsidian_export_service import export_todo, remove_todo_from_vault
from services import task_relationship_service
from utils import apply_model_updates, make_id, serialize_tags

logger = logging.getLogger(__name__)

_DEPENDENCIES_UNSET = object()


_ORDER_COLUMNS = {
    "created_at": Todo.created_at,
    "updated_at": Todo.updated_at,
    "sort_order": Todo.sort_order,
    "priority": Todo.priority,
}


async def get_todos(
    db: AsyncSession,
    *,
    status_filter: TaskStatus | None = None,
    priority: str | None = None,
    due_before: datetime | None = None,
    project_id: str | None = None,
    parent_id: str | None = None,
    root_only: bool = False,
    order_by: str = "created_at",
    order_dir: str = "desc",
    page: int = 1,
    limit: int = 20,
) -> tuple[list[Todo], int]:
    conditions = []
    if status_filter is not None:
        conditions.append(Todo.status == status_filter)
    if priority is not None:
        conditions.append(Todo.priority == priority)
    if due_before is not None:
        conditions.append(Todo.due_date <= due_before)
    if project_id is not None:
        conditions.append(Todo.project_id == project_id)
    if parent_id is not None:
        conditions.append(Todo.parent_id == parent_id)
    if root_only:
        conditions.append(Todo.parent_id.is_(None))

    count_q = select(func.count(Todo.id)).where(*conditions)
    total = (await db.execute(count_q)).scalar() or 0

    col = _ORDER_COLUMNS.get(order_by, Todo.created_at)
    order_clause = col.asc() if order_dir == "asc" else col.desc()

    q = (
        select(Todo)
        .where(*conditions)
        .order_by(order_clause)
        .offset((page - 1) * limit)
        .limit(limit)
    )
    rows = (await db.execute(q)).scalars().all()
    return list(rows), total


async def get_todo(db: AsyncSession, todo_id: str) -> Todo:
    todo = await db.get(Todo, todo_id)
    if not todo:
        raise NotFoundError(f"Todo {todo_id} not found")
    return todo


async def create_todo(
    db: AsyncSession,
    *,
    title: str,
    description: str | None = None,
    project_id: str | None = None,
    status: TaskStatus = TaskStatus.PENDING,
    priority: str = "medium",
    due_date: datetime | None = None,
    tags: list[str] | None = None,
    parent_id: str | None = None,
    sort_order: int = 0,
    source: str | None = None,
    source_id: str | None = None,
    assignee: str | None = None,
    enabled_skills: list[str] | None = None,
    inbox_state: str = "none",
    estimated_minutes: int | None = None,
    depends_on: list[str] | None = None,
    recurrence_rule: str | None = None,
    recurrence_end: datetime | None = None,
) -> Todo:
    if parent_id is not None:
        parent = await db.get(Todo, parent_id)
        if parent is None:
            raise NotFoundError(f"Parent todo {parent_id} not found")
        if project_id is not None and project_id != parent.project_id:
            raise ValidationError("A child task must belong to its parent's project")
        project_id = parent.project_id
    if project_id is not None and await db.get(Project, project_id) is None:
        raise NotFoundError(f"Project {project_id} not found")
    todo = Todo(
        id=make_id("todo_"),
        title=title,
        description=description,
        project_id=project_id,
        status=status,
        priority=priority,
        completed_at=(
            datetime.now(timezone.utc) if status == TaskStatus.COMPLETED else None
        ),
        due_date=due_date,
        tags=serialize_tags(tags),
        parent_id=parent_id,
        sort_order=sort_order,
        source=source,
        source_id=source_id,
        assignee=assignee,
        enabled_skills=json.dumps(enabled_skills) if enabled_skills else None,
        inbox_state=inbox_state,
        estimated_minutes=estimated_minutes,
        depends_on=None,
        recurrence_rule=recurrence_rule,
        recurrence_end=recurrence_end,
    )
    db.add(todo)
    await db.flush()

    if depends_on is not None:
        await task_relationship_service.replace_task_dependencies(
            db,
            todo.id,
            depends_on,
        )

    if settings.obsidian_vault_path:
        project_name = None
        if todo.parent_id:
            parent = await db.get(Todo, todo.parent_id)
            if parent:
                project_name = parent.title
        await asyncio.to_thread(
            export_todo, settings.obsidian_vault_path, todo, project_name
        )

    return todo


async def update_todo(db: AsyncSession, todo_id: str, **updates) -> Todo:
    todo = await get_todo(db, todo_id)
    dependency_ids = (
        updates.pop("depends_on")
        if "depends_on" in updates
        else _DEPENDENCIES_UNSET
    )
    proposed_parent_id = updates.get("parent_id", todo.parent_id)
    proposed_project_id = updates.get("project_id", todo.project_id)
    if proposed_parent_id is not None:
        parent = await get_todo(db, proposed_parent_id)
        if proposed_project_id is not None and proposed_project_id != parent.project_id:
            raise ValidationError("A child task must belong to its parent's project")
        updates["project_id"] = parent.project_id
    elif proposed_project_id is not None and await db.get(Project, proposed_project_id) is None:
        raise NotFoundError(f"Project {proposed_project_id} not found")
    apply_model_updates(todo, updates)

    if "status" in updates:
        if updates["status"] == TaskStatus.COMPLETED and not todo.completed_at:
            todo.completed_at = datetime.now(timezone.utc)
        elif updates["status"] != TaskStatus.COMPLETED:
            todo.completed_at = None

    if dependency_ids is not _DEPENDENCIES_UNSET:
        await task_relationship_service.replace_task_dependencies(
            db,
            todo.id,
            dependency_ids,
        )

    await db.flush()

    if settings.obsidian_vault_path:
        project_name = None
        if todo.parent_id:
            parent = await db.get(Todo, todo.parent_id)
            if parent:
                project_name = parent.title
        await asyncio.to_thread(
            export_todo, settings.obsidian_vault_path, todo, project_name
        )

    return todo


async def delete_todo(db: AsyncSession, todo_id: str) -> None:
    todo = await get_todo(db, todo_id)
    deleted_id = todo.id
    dependent_source_ids = await task_relationship_service.dependent_source_ids(
        db,
        {todo.id},
    )
    await db.delete(todo)
    await db.flush()
    await task_relationship_service.sync_dependency_shadows(
        db,
        dependent_source_ids,
    )
    await db.flush()

    if settings.obsidian_vault_path:
        await asyncio.to_thread(
            remove_todo_from_vault, settings.obsidian_vault_path, deleted_id
        )
