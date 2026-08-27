"""Validation and persistence for normalized task relationships."""

import json
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import NoReturn

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from domain.task_relationship import TaskRelationshipType
from exceptions import ConflictError, NotFoundError, ValidationError
from models.task_relationship import TaskRelationship
from models.todo import Todo
from schemas.task_relationship import TaskRelationshipCreate, TaskRelationshipUpdate
from schemas.task_relationship import TaskDependencyCommandRequest
from services.graph_command_service import (
    changed_graph_task_ids,
    claim_graph_revision,
    current_graph_revision,
    insight_delta,
    load_graph_insights,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _raise_integrity_error(
    exc: IntegrityError,
    conflict_message: str,
) -> NoReturn:
    """Map DB graph protection and uniqueness races to stable API errors."""
    if "dependency cycle detected" in str(exc).lower():
        raise ValidationError("Dependency cycle detected") from exc
    raise ConflictError(conflict_message) from exc


def _parse_legacy_dependencies(todo_id: str, raw: str | None) -> list[str]:
    if raw is None or raw == "":
        return []
    try:
        value = json.loads(raw)
    except (json.JSONDecodeError, TypeError) as exc:
        raise ValidationError(
            f"Todo {todo_id} has malformed depends_on JSON"
        ) from exc
    if not isinstance(value, list):
        raise ValidationError(f"Todo {todo_id} depends_on must be a JSON array")
    if any(not isinstance(dependency_id, str) or not dependency_id for dependency_id in value):
        raise ValidationError(
            f"Todo {todo_id} depends_on must contain non-empty task IDs"
        )
    if len(value) != len(set(value)):
        raise ValidationError(f"Todo {todo_id} has duplicate dependencies")
    return value


def _assert_dependency_dag(edges: list[tuple[str, str]]) -> None:
    adjacency: dict[str, list[str]] = defaultdict(list)
    in_degree: dict[str, int] = {}
    for source_task_id, target_task_id in edges:
        if source_task_id == target_task_id:
            raise ValidationError("A task cannot depend on itself")
        adjacency[source_task_id].append(target_task_id)
        in_degree.setdefault(source_task_id, 0)
        in_degree[target_task_id] = in_degree.get(target_task_id, 0) + 1

    ready = deque(
        task_id
        for task_id, degree in in_degree.items()
        if degree == 0
    )
    visited = 0
    while ready:
        task_id = ready.popleft()
        visited += 1
        for target_task_id in adjacency.get(task_id, []):
            in_degree[target_task_id] -= 1
            if in_degree[target_task_id] == 0:
                ready.append(target_task_id)

    if visited != len(in_degree):
        raise ValidationError("Dependency cycle detected")


def _dependency_path(
    edges: list[tuple[str, str]],
    start_task_id: str,
    goal_task_id: str,
) -> list[str] | None:
    adjacency: dict[str, list[str]] = defaultdict(list)
    for source_task_id, target_task_id in edges:
        adjacency[source_task_id].append(target_task_id)
    for targets in adjacency.values():
        targets.sort()

    queue = deque([start_task_id])
    previous: dict[str, str | None] = {start_task_id: None}
    while queue:
        task_id = queue.popleft()
        if task_id == goal_task_id:
            path: list[str] = []
            cursor: str | None = task_id
            while cursor is not None:
                path.append(cursor)
                cursor = previous[cursor]
            return list(reversed(path))
        for target_task_id in adjacency.get(task_id, []):
            if target_task_id not in previous:
                previous[target_task_id] = task_id
                queue.append(target_task_id)
    return None


async def _require_tasks(db: AsyncSession, task_ids: set[str]) -> None:
    if not task_ids:
        return
    rows = await db.execute(select(Todo.id).where(Todo.id.in_(task_ids)))
    existing_ids = set(rows.scalars().all())
    missing_ids = sorted(task_ids - existing_ids)
    if missing_ids:
        raise ValidationError(
            f"Relationship references missing task(s): {', '.join(missing_ids)}"
        )


async def _dependency_edges(
    db: AsyncSession,
    *,
    exclude_relationship_id: str | None = None,
    exclude_source_task_id: str | None = None,
) -> list[tuple[str, str]]:
    query = select(
        TaskRelationship.source_task_id,
        TaskRelationship.target_task_id,
    ).where(TaskRelationship.type == TaskRelationshipType.DEPENDS_ON)
    if exclude_relationship_id is not None:
        query = query.where(TaskRelationship.id != exclude_relationship_id)
    if exclude_source_task_id is not None:
        query = query.where(
            TaskRelationship.source_task_id != exclude_source_task_id
        )
    return list((await db.execute(query)).all())


async def _validate_candidate(
    db: AsyncSession,
    *,
    source_task_id: str,
    target_task_id: str,
    relationship_type: TaskRelationshipType,
    exclude_relationship_id: str | None = None,
) -> None:
    if source_task_id == target_task_id:
        raise ValidationError("A task relationship cannot reference itself")
    await _require_tasks(db, {source_task_id, target_task_id})

    duplicate_query = select(TaskRelationship.id).where(
        TaskRelationship.source_task_id == source_task_id,
        TaskRelationship.target_task_id == target_task_id,
        TaskRelationship.type == relationship_type,
    )
    if exclude_relationship_id is not None:
        duplicate_query = duplicate_query.where(
            TaskRelationship.id != exclude_relationship_id
        )
    if (await db.execute(duplicate_query.limit(1))).scalar_one_or_none() is not None:
        raise ConflictError("The task relationship already exists")

    if relationship_type == TaskRelationshipType.DEPENDS_ON:
        edges = await _dependency_edges(
            db,
            exclude_relationship_id=exclude_relationship_id,
        )
        existing_path = _dependency_path(
            edges,
            target_task_id,
            source_task_id,
        )
        if existing_path is not None:
            cycle_task_ids = [source_task_id, *existing_path]
            raise ValidationError(
                "Dependency cycle detected",
                details={
                    "reason": "dependency_cycle",
                    "proposed_edge": {
                        "source_task_id": source_task_id,
                        "target_task_id": target_task_id,
                    },
                    "existing_path_task_ids": existing_path,
                    "cycle_task_ids": cycle_task_ids,
                },
            )
        edges.append((source_task_id, target_task_id))
        _assert_dependency_dag(edges)


async def preview_dependency_command(
    db: AsyncSession,
    body: TaskDependencyCommandRequest,
) -> tuple[list[str], dict[str, int | None] | None]:
    current = await current_graph_revision(db)
    if current != body.expected_graph_revision:
        raise ConflictError(
            f"Task graph changed from revision {body.expected_graph_revision} to {current}; "
            "refresh and retry",
            details={
                "expected_graph_revision": body.expected_graph_revision,
                "current_graph_revision": current,
            },
        )

    analysis_time = _now()
    before_insights = await load_graph_insights(db, generated_at=analysis_time)
    nested = await db.begin_nested()
    try:
        await create_relationship(
            db,
            TaskRelationshipCreate(
                source_task_id=body.dependent_task_id,
                target_task_id=body.prerequisite_task_id,
                type=TaskRelationshipType.DEPENDS_ON,
            ),
        )
        after_insights = await load_graph_insights(db, generated_at=analysis_time)
    finally:
        await nested.rollback()
    return (
        changed_graph_task_ids(before_insights, after_insights),
        insight_delta(before_insights, after_insights),
    )


async def create_dependency_command(
    db: AsyncSession,
    body: TaskDependencyCommandRequest,
) -> tuple[TaskRelationship, int, list[str], dict[str, int | None] | None]:
    await claim_graph_revision(db, body.expected_graph_revision)
    analysis_time = _now()
    before_insights = await load_graph_insights(db, generated_at=analysis_time)
    relationship = await create_relationship(
        db,
        TaskRelationshipCreate(
            source_task_id=body.dependent_task_id,
            target_task_id=body.prerequisite_task_id,
            type=TaskRelationshipType.DEPENDS_ON,
        ),
    )
    after_insights = await load_graph_insights(db, generated_at=analysis_time)
    revision = await current_graph_revision(db)
    return (
        relationship,
        revision,
        changed_graph_task_ids(before_insights, after_insights),
        insight_delta(before_insights, after_insights),
    )


async def sync_dependency_shadow(
    db: AsyncSession,
    source_task_id: str,
    *,
    touch: bool = True,
) -> None:
    todo = await db.get(Todo, source_task_id)
    if todo is None:
        return
    rows = await db.execute(
        select(TaskRelationship.target_task_id)
        .where(
            TaskRelationship.source_task_id == source_task_id,
            TaskRelationship.type == TaskRelationshipType.DEPENDS_ON,
        )
        .order_by(TaskRelationship.created_at.asc(), TaskRelationship.id.asc())
    )
    dependency_ids = list(rows.scalars().all())
    todo.depends_on = json.dumps(dependency_ids) if dependency_ids else None
    if touch:
        todo.updated_at = _now()


async def sync_dependency_shadows(
    db: AsyncSession,
    source_task_ids: set[str],
    *,
    touch: bool = True,
) -> None:
    for source_task_id in sorted(source_task_ids):
        await sync_dependency_shadow(db, source_task_id, touch=touch)


async def list_relationships(
    db: AsyncSession,
    *,
    task_id: str | None = None,
    source_task_id: str | None = None,
    target_task_id: str | None = None,
    relationship_type: TaskRelationshipType | None = None,
    limit: int = 5000,
) -> list[TaskRelationship]:
    query = select(TaskRelationship)
    if task_id is not None:
        query = query.where(
            or_(
                TaskRelationship.source_task_id == task_id,
                TaskRelationship.target_task_id == task_id,
            )
        )
    if source_task_id is not None:
        query = query.where(TaskRelationship.source_task_id == source_task_id)
    if target_task_id is not None:
        query = query.where(TaskRelationship.target_task_id == target_task_id)
    if relationship_type is not None:
        query = query.where(TaskRelationship.type == relationship_type)
    rows = await db.execute(
        query.order_by(
            TaskRelationship.created_at.asc(),
            TaskRelationship.id.asc(),
        ).limit(limit)
    )
    return list(rows.scalars().all())


async def get_relationship(
    db: AsyncSession,
    relationship_id: str,
) -> TaskRelationship:
    relationship = await db.get(TaskRelationship, relationship_id)
    if relationship is None:
        raise NotFoundError(f"Task relationship {relationship_id} not found")
    return relationship


async def create_relationship(
    db: AsyncSession,
    body: TaskRelationshipCreate,
) -> TaskRelationship:
    await _validate_candidate(
        db,
        source_task_id=body.source_task_id,
        target_task_id=body.target_task_id,
        relationship_type=body.type,
    )
    relationship = TaskRelationship(
        source_task_id=body.source_task_id,
        target_task_id=body.target_task_id,
        type=body.type,
        label=body.label,
        created_by="user",
        proposal_id=None,
    )
    db.add(relationship)
    try:
        await db.flush()
    except IntegrityError as exc:
        _raise_integrity_error(
            exc,
            "The task relationship conflicts with existing data",
        )
    if body.type == TaskRelationshipType.DEPENDS_ON:
        await sync_dependency_shadow(db, body.source_task_id)
        await db.flush()
    return relationship


async def update_relationship(
    db: AsyncSession,
    relationship_id: str,
    body: TaskRelationshipUpdate,
) -> TaskRelationship:
    relationship = await get_relationship(db, relationship_id)
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        return relationship

    source_task_id = updates.get("source_task_id", relationship.source_task_id)
    target_task_id = updates.get("target_task_id", relationship.target_task_id)
    relationship_type = updates.get("type", relationship.type)
    relationship_type = TaskRelationshipType(relationship_type)

    await _validate_candidate(
        db,
        source_task_id=source_task_id,
        target_task_id=target_task_id,
        relationship_type=relationship_type,
        exclude_relationship_id=relationship.id,
    )

    old_source_task_id = relationship.source_task_id
    old_type = TaskRelationshipType(relationship.type)
    for field, value in updates.items():
        setattr(relationship, field, value)
    relationship.updated_at = _now()
    try:
        await db.flush()
    except IntegrityError as exc:
        _raise_integrity_error(
            exc,
            "The task relationship conflicts with existing data",
        )

    affected_source_ids: set[str] = set()
    if old_type == TaskRelationshipType.DEPENDS_ON:
        affected_source_ids.add(old_source_task_id)
    if relationship_type == TaskRelationshipType.DEPENDS_ON:
        affected_source_ids.add(source_task_id)
    await sync_dependency_shadows(db, affected_source_ids)
    await db.flush()
    return relationship


async def delete_relationship(
    db: AsyncSession,
    relationship_id: str,
) -> None:
    relationship = await get_relationship(db, relationship_id)
    source_task_id = relationship.source_task_id
    is_dependency = relationship.type == TaskRelationshipType.DEPENDS_ON
    await db.delete(relationship)
    await db.flush()
    if is_dependency:
        await sync_dependency_shadow(db, source_task_id)
        await db.flush()


async def replace_task_dependencies(
    db: AsyncSession,
    source_task_id: str,
    dependency_ids: list[str] | None,
    *,
    created_by: str = "user",
    proposal_id: str | None = None,
) -> list[TaskRelationship]:
    dependency_ids = dependency_ids or []
    created_by = created_by.strip()
    if not created_by:
        raise ValidationError("created_by must not be blank")
    if len(dependency_ids) != len(set(dependency_ids)):
        raise ValidationError("A task cannot contain duplicate dependencies")
    if source_task_id in dependency_ids:
        raise ValidationError("A task cannot depend on itself")
    await _require_tasks(db, {source_task_id, *dependency_ids})

    edges = await _dependency_edges(
        db,
        exclude_source_task_id=source_task_id,
    )
    edges.extend((source_task_id, target_task_id) for target_task_id in dependency_ids)
    _assert_dependency_dag(edges)

    existing_relationships = list(
        (
            await db.execute(
                select(TaskRelationship).where(
                    TaskRelationship.source_task_id == source_task_id,
                    TaskRelationship.type == TaskRelationshipType.DEPENDS_ON,
                )
            )
        ).scalars().all()
    )
    existing_by_target = {
        relationship.target_task_id: relationship
        for relationship in existing_relationships
    }
    desired_targets = set(dependency_ids)
    for relationship in existing_relationships:
        if relationship.target_task_id not in desired_targets:
            await db.delete(relationship)

    new_relationships = [
        TaskRelationship(
            source_task_id=source_task_id,
            target_task_id=target_task_id,
            type=TaskRelationshipType.DEPENDS_ON,
            created_by=created_by,
            proposal_id=proposal_id,
        )
        for target_task_id in dependency_ids
        if target_task_id not in existing_by_target
    ]
    db.add_all(new_relationships)
    try:
        await db.flush()
    except IntegrityError as exc:
        _raise_integrity_error(
            exc,
            "The task dependency update conflicts with existing data",
        )
    await sync_dependency_shadow(db, source_task_id)
    await db.flush()
    new_by_target = {
        relationship.target_task_id: relationship
        for relationship in new_relationships
    }
    return [
        existing_by_target.get(target_task_id)
        or new_by_target[target_task_id]
        for target_task_id in dependency_ids
    ]


async def dependent_source_ids(
    db: AsyncSession,
    target_task_ids: set[str],
) -> set[str]:
    if not target_task_ids:
        return set()
    rows = await db.execute(
        select(TaskRelationship.source_task_id)
        .where(
            TaskRelationship.target_task_id.in_(target_task_ids),
            TaskRelationship.type == TaskRelationshipType.DEPENDS_ON,
        )
        .distinct()
    )
    return set(rows.scalars().all()) - target_task_ids


async def backfill_legacy_dependencies(db: AsyncSession) -> int:
    todo_rows = list((await db.execute(select(Todo.id, Todo.depends_on))).all())
    todo_ids = {todo_id for todo_id, _raw in todo_rows}
    desired_edges: list[tuple[str, str]] = []
    for todo_id, raw_dependencies in todo_rows:
        dependency_ids = _parse_legacy_dependencies(todo_id, raw_dependencies)
        for target_task_id in dependency_ids:
            if target_task_id not in todo_ids:
                raise ValidationError(
                    f"Todo {todo_id} references missing dependency {target_task_id}"
                )
            desired_edges.append((todo_id, target_task_id))

    existing_rows = list(
        (
            await db.execute(
                select(
                    TaskRelationship.source_task_id,
                    TaskRelationship.target_task_id,
                ).where(TaskRelationship.type == TaskRelationshipType.DEPENDS_ON)
            )
        ).all()
    )
    await _require_tasks(
        db,
        {
            task_id
            for source_task_id, target_task_id in existing_rows
            for task_id in (source_task_id, target_task_id)
        },
    )
    existing_edges = set(existing_rows)
    combined_edges = list(existing_edges)
    combined_edges.extend(edge for edge in desired_edges if edge not in existing_edges)
    _assert_dependency_dag(combined_edges)

    missing_edges = [edge for edge in desired_edges if edge not in existing_edges]
    db.add_all(
        [
            TaskRelationship(
                source_task_id=source_task_id,
                target_task_id=target_task_id,
                type=TaskRelationshipType.DEPENDS_ON,
                created_by="legacy",
            )
            for source_task_id, target_task_id in missing_edges
        ]
    )
    await db.flush()
    await reconcile_dependency_shadows(db)
    return len(missing_edges)


async def reconcile_dependency_shadows(db: AsyncSession) -> int:
    """Overwrite every legacy JSON shadow from normalized dependency rows."""
    todos = list((await db.execute(select(Todo))).scalars().all())
    todo_ids = {todo.id for todo in todos}
    relationship_rows = list(
        (
            await db.execute(
                select(
                    TaskRelationship.source_task_id,
                    TaskRelationship.target_task_id,
                )
                .where(TaskRelationship.type == TaskRelationshipType.DEPENDS_ON)
                .order_by(
                    TaskRelationship.created_at.asc(),
                    TaskRelationship.id.asc(),
                )
            )
        ).all()
    )
    referenced_ids = {
        task_id
        for source_task_id, target_task_id in relationship_rows
        for task_id in (source_task_id, target_task_id)
    }
    missing_ids = sorted(referenced_ids - todo_ids)
    if missing_ids:
        raise ValidationError(
            f"Relationship references missing task(s): {', '.join(missing_ids)}"
        )
    _assert_dependency_dag(relationship_rows)

    dependencies_by_source: dict[str, list[str]] = defaultdict(list)
    for source_task_id, target_task_id in relationship_rows:
        dependencies_by_source[source_task_id].append(target_task_id)
    for todo in todos:
        dependency_ids = dependencies_by_source.get(todo.id, [])
        todo.depends_on = json.dumps(dependency_ids) if dependency_ids else None
    await db.flush()
    return len(relationship_rows)
