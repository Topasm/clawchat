"""Steps in one task's flow: its direct children and the order between them.

A step is an ordinary child task. Its order is ordinary ``depends_on`` rows
between siblings, so the graph, readiness and runs see the same thing the flow
draws. Each command writes its child task, edges and sort orders together and
records them in a ``TaskStepChange`` so one undo puts the flow back.
"""

import json
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from domain.task import TaskStatus
from domain.task_relationship import TaskRelationshipType
from exceptions import ConflictError, NotFoundError, ValidationError
from models.task_relationship import TaskRelationship
from models.task_step_change import TaskStepChange
from models.todo import Todo
from schemas.task_relationship import TaskRelationshipCreate
from services.tasks import task_relationship_service, todo_service
from services.tasks.task_plan_guard_service import require_editable_plan

Edge = tuple[str, str]


async def _steps(db: AsyncSession, parent_id: str) -> list[Todo]:
    return list(
        (
            await db.execute(
                select(Todo)
                .where(Todo.parent_id == parent_id)
                .order_by(Todo.sort_order.asc(), Todo.created_at.asc(), Todo.id.asc())
            )
        ).scalars()
    )


async def _step_edges(
    db: AsyncSession, step_ids: set[str]
) -> dict[Edge, TaskRelationship]:
    if not step_ids:
        return {}
    rows = (
        await db.execute(
            select(TaskRelationship).where(
                TaskRelationship.type == TaskRelationshipType.DEPENDS_ON,
                TaskRelationship.source_task_id.in_(step_ids),
                TaskRelationship.target_task_id.in_(step_ids),
            )
        )
    ).scalars()
    return {(row.source_task_id, row.target_task_id): row for row in rows}


def _prerequisites(edges: set[Edge], step_id: str) -> set[str]:
    return {target for source, target in edges if source == step_id}


def _dependents(edges: set[Edge], step_id: str) -> set[str]:
    return {source for source, target in edges if target == step_id}


def _relationship_state(row: TaskRelationship) -> dict[str, object]:
    created_at = row.created_at
    if created_at is not None and created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    return {
        "id": row.id,
        "source_task_id": row.source_task_id,
        "target_task_id": row.target_task_id,
        "type": row.type,
        "label": row.label,
        "created_by": row.created_by,
        "proposal_id": row.proposal_id,
        "created_at": created_at.isoformat() if created_at else None,
    }


async def _require_parent(db: AsyncSession, parent_id: str) -> Todo:
    parent = await db.get(Todo, parent_id)
    if parent is None:
        raise NotFoundError(f"Todo {parent_id} not found")
    return parent


def _require_step(steps: dict[str, Todo], step_id: str, field: str) -> Todo:
    step = steps.get(step_id)
    if step is None:
        raise ValidationError(
            f"{field} must be a step of this task",
            details={field: step_id},
        )
    return step


async def _apply_edges(
    db: AsyncSession,
    original: dict[Edge, TaskRelationship],
    final: set[Edge],
) -> tuple[list[str], list[dict[str, object]]]:
    """Delete and create sibling edges; edges kept keep their IDs."""
    removed: list[dict[str, object]] = []
    for edge in sorted(set(original) - final):
        row = original[edge]
        removed.append(_relationship_state(row))
        await task_relationship_service.delete_relationship(db, row.id)
    added: list[str] = []
    for source, target in sorted(final - set(original)):
        row = await task_relationship_service.create_relationship(
            db,
            TaskRelationshipCreate(
                source_task_id=source,
                target_task_id=target,
                type=TaskRelationshipType.DEPENDS_ON,
            ),
        )
        added.append(row.id)
    return added, removed


def _affected(*groups: object) -> list[str]:
    ids: set[str] = set()
    for group in groups:
        if isinstance(group, (set, list, tuple)):
            ids.update(str(item) for item in group)
    return sorted(ids)


async def add_step(
    db: AsyncSession,
    parent_id: str,
    *,
    title: str,
    branch_from_id: str | None = None,
    after_id: str | None = None,
) -> tuple[Todo, TaskStepChange, list[str]]:
    if branch_from_id is not None and after_id is not None:
        raise ValidationError("Give either branch_from_id or after_id, not both")
    await _require_parent(db, parent_id)
    siblings = await _steps(db, parent_id)
    by_id = {step.id: step for step in siblings}
    original = await _step_edges(db, set(by_id))
    edges = set(original)

    if branch_from_id is not None:
        _require_step(by_id, branch_from_id, "branch_from_id")
        prerequisites = _prerequisites(edges, branch_from_id)
        dependents = _dependents(edges, branch_from_id)
    elif after_id is not None:
        # Right after one step: what waited on it now waits on the new one.
        _require_step(by_id, after_id, "after_id")
        prerequisites = {after_id}
        dependents = _dependents(edges, after_id)
        edges -= {(source, after_id) for source in dependents}
    else:
        # After the flow's current ends: ordered steps no other live step
        # waits on. Steps with no order at all stay out of it; with nothing
        # ordered yet the newest step starts the chain.
        live = [step for step in siblings if step.status != TaskStatus.CANCELLED]
        live_ids = {step.id for step in live}
        live_edges = {(a, b) for a, b in edges if a in live_ids and b in live_ids}
        ordered = {task_id for edge in live_edges for task_id in edge}
        if ordered:
            prerequisites = ordered - {target for _, target in live_edges}
        else:
            prerequisites = {live[-1].id} if live else set()
        dependents = set()

    step = await todo_service.create_todo(
        db,
        title=title,
        parent_id=parent_id,
        inbox_state="none",
        sort_order=max((item.sort_order or 0 for item in siblings), default=-10) + 10,
    )
    final = edges | {(step.id, target) for target in prerequisites}
    final |= {(source, step.id) for source in dependents}
    added, _ = await _apply_edges(db, original, final)

    change = TaskStepChange(
        todo_id=parent_id,
        kind="add",
        created_todo_ids_json=json.dumps([step.id]),
        added_relationship_ids_json=json.dumps(added),
    )
    db.add(change)
    await db.flush()
    return step, change, _affected({step.id, parent_id}, prerequisites, dependents)


async def move_step(
    db: AsyncSession,
    parent_id: str,
    *,
    step_id: str,
    after_id: str | None,
) -> tuple[Todo, TaskStepChange, list[str]]:
    await _require_parent(db, parent_id)
    siblings = await _steps(db, parent_id)
    by_id = {step.id: step for step in siblings}
    moved = _require_step(by_id, step_id, "step_id")
    if after_id is not None:
        _require_step(by_id, after_id, "after_id")
        if after_id == step_id:
            raise ValidationError("A step cannot move after itself")
    original = await _step_edges(db, set(by_id))
    edges = set(original)

    # Take the step out, joining what came before it to what came after it.
    before = _prerequisites(edges, step_id)
    after = _dependents(edges, step_id)
    edges = {edge for edge in edges if step_id not in edge}
    edges |= {(source, target) for source in after for target in before}

    # Put it back in right after its new predecessor.
    if after_id is not None:
        for source in _dependents(edges, after_id):
            edges.discard((source, after_id))
            edges.add((source, step_id))
        edges.add((step_id, after_id))
    else:
        starts = {
            step.id
            for step in siblings
            if step.id != step_id
            and step.status != TaskStatus.CANCELLED
            and not _prerequisites(edges, step.id)
        }
        edges |= {(source, step_id) for source in starts}

    if edges == set(original):
        raise ValidationError("The step is already there")
    added, removed = await _apply_edges(db, original, edges)

    ordered = [step for step in siblings if step.id != step_id]
    index = 0 if after_id is None else ordered.index(by_id[after_id]) + 1
    ordered.insert(index, moved)
    sort_orders: dict[str, list[int]] = {}
    for position, step in enumerate(ordered):
        if step.sort_order != position * 10:
            sort_orders[step.id] = [step.sort_order or 0, position * 10]
            step.sort_order = position * 10
            step.updated_at = datetime.now(timezone.utc)
    await db.flush()

    change = TaskStepChange(
        todo_id=parent_id,
        kind="move",
        added_relationship_ids_json=json.dumps(added),
        removed_relationships_json=json.dumps(removed, sort_keys=True),
        sort_orders_json=json.dumps(sort_orders, sort_keys=True),
    )
    db.add(change)
    await db.flush()
    touched = {source for source, _ in edges ^ set(original)}
    return moved, change, _affected({step_id}, touched, set(sort_orders))


async def undo_step_change(
    db: AsyncSession,
    change_id: str,
) -> tuple[TaskStepChange, list[str]]:
    change = await db.get(TaskStepChange, change_id)
    if change is None:
        raise NotFoundError(f"Step change {change_id} not found")
    if change.status != "applied":
        raise ConflictError("This step change has already been undone")

    created_ids: list[str] = json.loads(change.created_todo_ids_json)
    added_ids: list[str] = json.loads(change.added_relationship_ids_json)
    removed: list[dict[str, object]] = json.loads(change.removed_relationships_json)
    sort_orders: dict[str, list[int]] = json.loads(change.sort_orders_json)

    created = [todo for todo_id in created_ids if (todo := await db.get(Todo, todo_id))]
    if created:
        has_children = (
            await db.execute(
                select(Todo.id)
                .where(Todo.parent_id.in_([todo.id for todo in created]))
                .limit(1)
            )
        ).scalar_one_or_none()
        if has_children is not None:
            raise ConflictError(
                "Cannot undo because the new step has steps of its own now"
            )

    affected: set[str] = set(created_ids)
    for relationship_id in added_ids:
        row = await db.get(TaskRelationship, relationship_id)
        if row is not None:
            affected.add(row.source_task_id)
            await task_relationship_service.delete_relationship(db, row.id)

    restored_sources: set[str] = set()
    for state in removed:
        source = str(state["source_task_id"])
        target = str(state["target_task_id"])
        if await db.get(Todo, source) is None or await db.get(Todo, target) is None:
            continue
        duplicate = (
            await db.execute(
                select(TaskRelationship.id).where(
                    TaskRelationship.source_task_id == source,
                    TaskRelationship.target_task_id == target,
                    TaskRelationship.type == state["type"],
                )
            )
        ).scalar_one_or_none()
        if duplicate is not None or await db.get(TaskRelationship, str(state["id"])):
            continue
        created_at = state.get("created_at")
        db.add(
            TaskRelationship(
                id=str(state["id"]),
                source_task_id=source,
                target_task_id=target,
                type=str(state["type"]),
                label=state.get("label"),
                created_by=str(state.get("created_by") or "user"),
                proposal_id=state.get("proposal_id"),
                created_at=(
                    datetime.fromisoformat(str(created_at))
                    if created_at
                    else datetime.now(timezone.utc)
                ),
            )
        )
        restored_sources.add(source)
    if restored_sources:
        await require_editable_plan(db, sorted(restored_sources))
        await db.flush()
        edges = await task_relationship_service._dependency_edges(db)
        task_relationship_service._assert_dependency_dag(edges)
        await task_relationship_service.sync_dependency_shadows(db, restored_sources)
        affected |= restored_sources

    for todo_id, (previous, applied) in sort_orders.items():
        todo = await db.get(Todo, todo_id)
        if todo is not None and todo.sort_order == applied:
            todo.sort_order = previous
            todo.updated_at = datetime.now(timezone.utc)
            affected.add(todo_id)

    await db.flush()
    for todo in created:
        await todo_service.delete_todo(db, todo.id)

    change.status = "reverted"
    change.reverted_at = datetime.now(timezone.utc)
    await db.flush()
    return change, sorted(affected)
