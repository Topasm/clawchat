"""Atomic hierarchy placement with graph-revision CAS and conservative undo."""

import json
from datetime import datetime, timezone

from exceptions import ConflictError, NotFoundError, ValidationError
from models.project import Project
from models.task_placement_change import TaskPlacementChange
from models.todo import Todo
from schemas.task_placement import TaskPlacementGroup
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from services.graph_command_service import (
    claim_graph_revision,
    current_graph_revision,
    ensure_graph_revision_advanced,
    insight_delta,
    load_graph_insights,
)

__all__ = ["current_graph_revision"]


def _state(todo: Todo) -> dict[str, object]:
    return {
        "id": todo.id,
        "project_id": todo.project_id,
        "parent_id": todo.parent_id,
        "sort_order": todo.sort_order,
        "inbox_state": todo.inbox_state,
    }


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


async def place_tasks(
    db: AsyncSession,
    *,
    todo_ids: list[str],
    project_id: str | None,
    parent_id: str | None,
    before_id: str | None,
    inbox_state: str | None,
    expected_graph_revision: int,
) -> tuple[list[Todo], TaskPlacementChange, list[str], dict[str, int | None] | None]:
    if not todo_ids:
        raise ValidationError("At least one task is required for placement")
    if len(todo_ids) != len(set(todo_ids)):
        raise ValidationError("Task placement IDs must be unique")
    await claim_graph_revision(db, expected_graph_revision)
    rows = list((await db.execute(select(Todo).where(Todo.id.in_(todo_ids)))).scalars())
    by_id = {todo.id: todo for todo in rows}
    missing = [todo_id for todo_id in todo_ids if todo_id not in by_id]
    if missing:
        raise NotFoundError(f"Todos not found: {', '.join(missing)}")
    todos = [by_id[todo_id] for todo_id in todo_ids]

    project_root = (
        (
            await db.execute(
                select(Project.root_task_id).where(Project.root_task_id.in_(todo_ids))
            )
        )
        .scalars()
        .first()
    )
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
        if parent.project_id != project_id:
            raise ValidationError(
                "Parent and task placement must belong to the same project"
            )

    subtrees: dict[str, list[Todo]] = {}
    subtree_ids: set[str] = set()
    for todo in todos:
        subtree = await _subtree(db, todo.id)
        item_ids = {item.id for item in subtree}
        overlap = subtree_ids & item_ids
        if overlap:
            raise ValidationError(
                "Batch placement cannot include both a task and its descendant",
                details={"overlapping_task_ids": sorted(overlap)},
            )
        subtrees[todo.id] = subtree
        subtree_ids.update(item_ids)
    if effective_parent_id in subtree_ids:
        raise ValidationError(
            "This placement would create a parent cycle",
            details={"todo_ids": todo_ids, "parent_id": effective_parent_id},
        )

    analysis_time = datetime.now(timezone.utc)
    before_insights = await load_graph_insights(db, generated_at=analysis_time)

    target_scope = (project_id, effective_parent_id)
    old_scopes = {(todo.project_id, todo.parent_id) for todo in todos}
    selected_ids = set(todo_ids)
    scope_siblings = {
        scope: await _siblings(db, *scope) for scope in old_scopes | {target_scope}
    }
    target_items = [
        item for item in scope_siblings[target_scope] if item.id not in selected_ids
    ]
    if before_id is not None:
        before_index = next(
            (index for index, item in enumerate(target_items) if item.id == before_id),
            None,
        )
        if before_index is None:
            raise ValidationError("before_id must be a sibling in the target location")
        target_items[before_index:before_index] = todos
    else:
        target_items.extend(todos)

    changed_candidates: dict[str, Todo] = {}
    for subtree in subtrees.values():
        changed_candidates.update({item.id: item for item in subtree})
    for siblings in scope_siblings.values():
        changed_candidates.update({item.id: item for item in siblings})
    before = [_state(item) for item in changed_candidates.values()]
    for scope in old_scopes - {target_scope}:
        _renumber(
            [item for item in scope_siblings[scope] if item.id not in selected_ids]
        )
    for todo in todos:
        todo.parent_id = effective_parent_id
        todo.inbox_state = inbox_state or ("captured" if project_id is None else "none")
        for item in subtrees[todo.id]:
            item.project_id = project_id
    _renumber(target_items)
    await db.flush()
    after_insights = await load_graph_insights(db, generated_at=analysis_time)

    after = [_state(item) for item in changed_candidates.values()]
    affected_ids = sorted(
        str(state["id"])
        for state, next_state in zip(before, after, strict=True)
        if state != next_state
    )
    if not affected_ids:
        raise ValidationError("Task is already at the requested placement")
    applied_revision = await ensure_graph_revision_advanced(
        db,
        expected_graph_revision,
    )
    change = TaskPlacementChange(
        todo_id=todos[0].id,
        base_graph_revision=expected_graph_revision,
        applied_graph_revision=applied_revision,
        before_json=json.dumps(before, sort_keys=True),
        after_json=json.dumps(after, sort_keys=True),
    )
    db.add(change)
    await db.flush()
    return todos, change, affected_ids, insight_delta(before_insights, after_insights)


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
    todos, change, affected_ids, delta = await place_tasks(
        db,
        todo_ids=[todo_id],
        project_id=project_id,
        parent_id=parent_id,
        before_id=before_id,
        inbox_state=inbox_state,
        expected_graph_revision=expected_graph_revision,
    )
    return todos[0], change, affected_ids, delta


async def place_task_groups(
    db: AsyncSession,
    *,
    groups: list[TaskPlacementGroup],
    expected_graph_revision: int,
) -> tuple[list[Todo], TaskPlacementChange, list[str], dict[str, int | None] | None]:
    """Apply multiple placement destinations as one revision-bound undo unit."""
    if not groups:
        raise ValidationError("At least one placement group is required")

    todo_ids = [todo_id for group in groups for todo_id in group.todo_ids]
    if len(todo_ids) != len(set(todo_ids)):
        raise ValidationError("A task can appear in only one placement group")

    before_insights = await load_graph_insights(
        db,
        generated_at=datetime.now(timezone.utc),
    )
    revision = expected_graph_revision
    moved: list[Todo] = []
    before_by_id: dict[str, dict[str, object]] = {}
    after_by_id: dict[str, dict[str, object]] = {}
    temporary_changes: list[TaskPlacementChange] = []

    for group in groups:
        group_todos, change, _, _ = await place_tasks(
            db,
            todo_ids=list(group.todo_ids),
            project_id=group.project_id,
            parent_id=group.parent_id,
            before_id=group.before_id,
            inbox_state=group.inbox_state,
            expected_graph_revision=revision,
        )
        moved.extend(group_todos)
        temporary_changes.append(change)
        revision = change.applied_graph_revision
        for state in json.loads(change.before_json):
            before_by_id.setdefault(str(state["id"]), state)
        for state in json.loads(change.after_json):
            after_by_id[str(state["id"])] = state

    for change in temporary_changes:
        await db.delete(change)

    before = [before_by_id[todo_id] for todo_id in sorted(before_by_id)]
    after = [
        after_by_id.get(todo_id, before_by_id[todo_id])
        for todo_id in sorted(before_by_id)
    ]
    affected_ids = [
        str(previous["id"])
        for previous, current in zip(before, after, strict=True)
        if previous != current
    ]
    after_insights = await load_graph_insights(
        db,
        generated_at=datetime.now(timezone.utc),
    )
    aggregate = TaskPlacementChange(
        todo_id=moved[0].id,
        base_graph_revision=expected_graph_revision,
        applied_graph_revision=revision,
        before_json=json.dumps(before, sort_keys=True),
        after_json=json.dumps(after, sort_keys=True),
    )
    db.add(aggregate)
    await db.flush()
    return (
        moved,
        aggregate,
        affected_ids,
        insight_delta(before_insights, after_insights),
    )


async def undo_placement(
    db: AsyncSession,
    change_set_id: str,
) -> tuple[Todo, TaskPlacementChange, list[str], dict[str, int | None] | None]:
    change = await db.get(TaskPlacementChange, change_set_id)
    if change is None:
        raise NotFoundError(f"Placement change {change_set_id} not found")
    if change.status != "applied":
        raise ConflictError("This placement has already been reverted")
    await claim_graph_revision(db, change.applied_graph_revision)
    analysis_time = datetime.now(timezone.utc)
    before_insights = await load_graph_insights(db, generated_at=analysis_time)

    before: list[dict[str, object]] = json.loads(change.before_json)
    after: list[dict[str, object]] = json.loads(change.after_json)
    after_by_id = {str(state["id"]): state for state in after}
    ids = [str(state["id"]) for state in before]
    rows = list((await db.execute(select(Todo).where(Todo.id.in_(ids)))).scalars())
    by_id = {todo.id: todo for todo in rows}
    missing = sorted(set(ids) - set(by_id))
    if missing:
        raise ConflictError(
            f"Cannot undo because tasks no longer exist: {', '.join(missing)}"
        )

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
            "Cannot undo because placement fields changed later: "
            + ", ".join(conflicts)
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
    after_insights = await load_graph_insights(db, generated_at=analysis_time)
    reverted_revision = await ensure_graph_revision_advanced(
        db,
        change.applied_graph_revision,
    )
    change.status = "reverted"
    change.reverted_graph_revision = reverted_revision
    change.reverted_at = datetime.now(timezone.utc)
    await db.flush()
    return (
        by_id[change.todo_id],
        change,
        sorted(restored_ids),
        insight_delta(before_insights, after_insights),
    )
