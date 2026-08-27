"""Atomic hierarchy placement with graph-revision CAS and conservative undo."""

import json
from datetime import datetime, timezone

from domain.plan_proposal import GLOBAL_TASK_GRAPH_SCOPE_ID
from exceptions import AppError, ConflictError, NotFoundError, ValidationError
from models.project import Project
from models.task_graph_state import TaskGraphState
from models.task_placement_change import TaskPlacementChange
from models.todo import Todo
from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from services import graph_insights_service


def _state(todo: Todo) -> dict[str, object]:
    return {
        "id": todo.id,
        "project_id": todo.project_id,
        "parent_id": todo.parent_id,
        "sort_order": todo.sort_order,
        "inbox_state": todo.inbox_state,
    }


async def current_graph_revision(db: AsyncSession) -> int:
    revision = (
        await db.execute(
            select(TaskGraphState.revision).where(
                TaskGraphState.scope_id == GLOBAL_TASK_GRAPH_SCOPE_ID
            )
        )
    ).scalar_one_or_none()
    return revision or 0


async def _claim_revision(db: AsyncSession, expected: int) -> None:
    claimed = (
        await db.execute(
            update(TaskGraphState)
            .where(
                TaskGraphState.scope_id == GLOBAL_TASK_GRAPH_SCOPE_ID,
                TaskGraphState.revision == expected,
            )
            .values(revision=TaskGraphState.revision)
            .returning(TaskGraphState.revision)
        )
    ).scalar_one_or_none()
    if claimed is None:
        current = await current_graph_revision(db)
        raise ConflictError(
            f"Task graph changed from revision {expected} to {current}; refresh and retry"
        )


async def _ensure_revision_advanced(db: AsyncSession, previous: int) -> int:
    """Advance placement-only changes that are outside Todo graph triggers."""
    current = await current_graph_revision(db)
    if current != previous:
        return current
    advanced = (
        await db.execute(
            update(TaskGraphState)
            .where(
                TaskGraphState.scope_id == GLOBAL_TASK_GRAPH_SCOPE_ID,
                TaskGraphState.revision == previous,
            )
            .values(
                revision=TaskGraphState.revision + 1,
                updated_at=datetime.now(timezone.utc),
            )
            .returning(TaskGraphState.revision)
        )
    ).scalar_one_or_none()
    if advanced is None:
        current = await current_graph_revision(db)
        raise ConflictError(
            f"Task graph changed from revision {previous} to {current}; refresh and retry"
        )
    return advanced


async def _subtree(db: AsyncSession, todo_id: str) -> list[Todo]:
    descendants = (
        select(Todo.id.label("id"))
        .where(Todo.id == todo_id)
        .cte("placement_descendants", recursive=True)
    )
    descendants = descendants.union(
        select(Todo.id.label("id")).join(
            descendants,
            Todo.parent_id == descendants.c.id,
        )
    )
    return list(
        (
            await db.execute(
                select(Todo)
                .where(Todo.id.in_(select(descendants.c.id)))
                .order_by(Todo.id.asc())
            )
        ).scalars()
    )


async def _siblings(
    db: AsyncSession,
    project_id: str | None,
    parent_id: str | None,
) -> list[Todo]:
    project_condition = (
        Todo.project_id.is_(None)
        if project_id is None
        else Todo.project_id == project_id
    )
    parent_condition = (
        Todo.parent_id.is_(None) if parent_id is None else Todo.parent_id == parent_id
    )
    return list(
        (
            await db.execute(
                select(Todo)
                .where(
                    project_condition,
                    parent_condition,
                    or_(Todo.source.is_(None), Todo.source != "project_root"),
                )
                .order_by(Todo.sort_order.asc(), Todo.created_at.asc(), Todo.id.asc())
            )
        ).scalars()
    )


def _renumber(items: list[Todo]) -> None:
    for index, item in enumerate(items):
        item.sort_order = index * 10


async def _insight_counts(db: AsyncSession) -> tuple[int, int, int | None] | None:
    try:
        insights = await graph_insights_service.get_graph_insights(db)
    except AppError:
        return None
    return (
        insights.summary.ready_count,
        insights.summary.blocked_count,
        insights.summary.critical_path_minutes,
    )


def _insight_delta(
    before: tuple[int, int, int | None] | None,
    after: tuple[int, int, int | None] | None,
) -> dict[str, int | None] | None:
    if before is None or after is None:
        return None
    before_critical = before[2]
    after_critical = after[2]
    return {
        "ready_count": after[0] - before[0],
        "blocked_count": after[1] - before[1],
        "critical_path_minutes": (
            after_critical - before_critical
            if after_critical is not None and before_critical is not None
            else None
        ),
    }


async def place_task(
    db: AsyncSession,
    *,
    todo_id: str,
    project_id: str | None,
    parent_id: str | None,
    before_id: str | None,
    inbox_state: str | None,
    expected_graph_revision: int,
) -> tuple[Todo, TaskPlacementChange, list[str], dict[str, int | None] | None]:
    await _claim_revision(db, expected_graph_revision)
    todo = await db.get(Todo, todo_id)
    if todo is None:
        raise NotFoundError(f"Todo {todo_id} not found")
    project_root = (
        await db.execute(select(Project.id).where(Project.root_task_id == todo.id))
    ).scalar_one_or_none()
    if project_root is not None:
        raise ValidationError("A project root cannot be moved through task placement")

    project = await db.get(Project, project_id) if project_id is not None else None
    if project_id is not None and project is None:
        raise NotFoundError(f"Project {project_id} not found")

    # A Project-root drop is expressed as ``parent_id=None`` by the API. Keep
    # the compatibility root Todo hidden from the UI while materializing the
    # task beneath it so Project-scoped Graph traversal remains complete.
    effective_parent_id = parent_id
    if project is not None and parent_id is None:
        effective_parent_id = project.root_task_id

    if effective_parent_id is not None:
        parent = await db.get(Todo, effective_parent_id)
        if parent is None:
            raise NotFoundError(f"Parent todo {effective_parent_id} not found")
        if parent.id == todo.id:
            raise ValidationError("A task cannot be its own parent")
        if parent.project_id != project_id:
            raise ValidationError("Parent and task placement must belong to the same project")

    subtree = await _subtree(db, todo.id)
    subtree_ids = {item.id for item in subtree}
    if effective_parent_id in subtree_ids:
        raise ValidationError(
            "This placement would create a parent cycle",
            details={"todo_id": todo.id, "parent_id": effective_parent_id},
        )

    before_insights = await _insight_counts(db)

    old_scope = (todo.project_id, todo.parent_id)
    new_scope = (project_id, effective_parent_id)
    old_siblings = await _siblings(db, *old_scope)
    new_siblings = old_siblings if new_scope == old_scope else await _siblings(db, *new_scope)
    target_items = [item for item in new_siblings if item.id != todo.id]
    if before_id is not None:
        before_index = next(
            (index for index, item in enumerate(target_items) if item.id == before_id),
            None,
        )
        if before_index is None:
            raise ValidationError("before_id must be a sibling in the target location")
        target_items.insert(before_index, todo)
    else:
        target_items.append(todo)

    changed_candidates = {
        item.id: item for item in [*subtree, *old_siblings, *new_siblings]
    }
    before = [_state(item) for item in changed_candidates.values()]
    if new_scope != old_scope:
        _renumber([item for item in old_siblings if item.id != todo.id])
    todo.parent_id = effective_parent_id
    for item in subtree:
        item.project_id = project_id
    todo.inbox_state = inbox_state or ("captured" if project_id is None else "none")
    _renumber(target_items)
    await db.flush()
    after_insights = await _insight_counts(db)

    after = [_state(item) for item in changed_candidates.values()]
    affected_ids = sorted(
        str(state["id"])
        for state, next_state in zip(before, after, strict=True)
        if state != next_state
    )
    if not affected_ids:
        raise ValidationError("Task is already at the requested placement")
    applied_revision = await _ensure_revision_advanced(db, expected_graph_revision)
    change = TaskPlacementChange(
        todo_id=todo.id,
        base_graph_revision=expected_graph_revision,
        applied_graph_revision=applied_revision,
        before_json=json.dumps(before, sort_keys=True),
        after_json=json.dumps(after, sort_keys=True),
    )
    db.add(change)
    await db.flush()
    return todo, change, affected_ids, _insight_delta(before_insights, after_insights)


async def undo_placement(
    db: AsyncSession,
    change_set_id: str,
) -> tuple[Todo, TaskPlacementChange, list[str], dict[str, int | None] | None]:
    change = await db.get(TaskPlacementChange, change_set_id)
    if change is None:
        raise NotFoundError(f"Placement change {change_set_id} not found")
    if change.status != "applied":
        raise ConflictError("This placement has already been reverted")
    await _claim_revision(db, change.applied_graph_revision)
    before_insights = await _insight_counts(db)

    before: list[dict[str, object]] = json.loads(change.before_json)
    after: list[dict[str, object]] = json.loads(change.after_json)
    after_by_id = {str(state["id"]): state for state in after}
    ids = [str(state["id"]) for state in before]
    rows = list((await db.execute(select(Todo).where(Todo.id.in_(ids)))).scalars())
    by_id = {todo.id: todo for todo in rows}
    missing = sorted(set(ids) - set(by_id))
    if missing:
        raise ConflictError(f"Cannot undo because tasks no longer exist: {', '.join(missing)}")

    conflicts: list[str] = []
    placement_fields = ("project_id", "parent_id", "sort_order", "inbox_state")
    restored_ids: list[str] = []
    for state in before:
        todo_id = str(state["id"])
        applied_state = after_by_id[todo_id]
        current_state = _state(by_id[todo_id])
        if any(state[field] != applied_state[field] for field in placement_fields):
            restored_ids.append(todo_id)
        for field in placement_fields:
            if (
                state[field] != applied_state[field]
                and current_state[field] != applied_state[field]
            ):
                conflicts.append(f"{todo_id}.{field}")
    if conflicts:
        raise ConflictError(
            "Cannot undo because placement fields changed later: " + ", ".join(conflicts)
        )

    for state in before:
        todo_id = str(state["id"])
        todo = by_id[todo_id]
        applied_state = after_by_id[todo_id]
        if state["project_id"] != applied_state["project_id"]:
            todo.project_id = state["project_id"]  # type: ignore[assignment]
        if state["parent_id"] != applied_state["parent_id"]:
            todo.parent_id = state["parent_id"]  # type: ignore[assignment]
        if state["sort_order"] != applied_state["sort_order"]:
            todo.sort_order = int(state["sort_order"])
        if state["inbox_state"] != applied_state["inbox_state"]:
            todo.inbox_state = str(state["inbox_state"])
    await db.flush()
    after_insights = await _insight_counts(db)
    reverted_revision = await _ensure_revision_advanced(db, change.applied_graph_revision)
    change.status = "reverted"
    change.reverted_graph_revision = reverted_revision
    change.reverted_at = datetime.now(timezone.utc)
    await db.flush()
    return (
        by_id[change.todo_id],
        change,
        sorted(restored_ids),
        _insight_delta(before_insights, after_insights),
    )
