"""Deterministic, read-only insights for the normalized task execution graph."""

from __future__ import annotations

import heapq
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timezone

from domain.graph_insights import (
    GraphDueRisk,
    GraphExecutionState,
    GraphIssueCode,
    GraphIssueSeverity,
    GraphScopeRole,
)
from domain.plan_proposal import GLOBAL_TASK_GRAPH_SCOPE_ID
from domain.task import TaskStatus
from domain.task_relationship import TaskRelationshipType
from exceptions import ConflictError, NotFoundError, ValidationError
from models.task_graph_state import TaskGraphState
from models.project import Project
from models.task_relationship import TaskRelationship
from models.todo import Todo
from schemas.graph_insights import (
    GraphInsightIssue,
    GraphInsightNode,
    GraphInsightScope,
    GraphInsightsResponse,
    GraphInsightSummary,
)
from sqlalchemy import distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

DEFAULT_GRAPH_INSIGHT_LIMIT = 2_000
MAX_GRAPH_INSIGHT_LIMIT = 5_000
_MAX_RELATIONSHIPS = 20_000
_MAX_ISSUES = 500
_MAX_RELATED_TASK_IDS = 20
_SNAPSHOT_ATTEMPTS = 3
_ACTIVE_STATUSES = frozenset({TaskStatus.PENDING, TaskStatus.IN_PROGRESS})


@dataclass(frozen=True, slots=True)
class _TaskSnapshot:
    id: str
    title: str
    status: TaskStatus
    parent_id: str | None
    estimated_minutes: int | None
    due_date: datetime | None


@dataclass(frozen=True, slots=True)
class _EdgeSnapshot:
    relationship_id: str
    source_task_id: str
    target_task_id: str


@dataclass(frozen=True, slots=True)
class _GraphSnapshot:
    revision: int
    root_task_id: str | None
    tasks: tuple[_TaskSnapshot, ...]
    edges: tuple[_EdgeSnapshot, ...]
    primary_ids: frozenset[str]
    container_ids: frozenset[str]
    existing_parent_ids: frozenset[str]


def _utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _has_valid_estimate(value: int | None) -> bool:
    # TodoCreate/TodoUpdate and persisted legacy data currently allow any
    # positive integer. The narrower AI-plan bound must not silently redefine
    # the canonical Todo contract in this read-only service.
    return value is not None and value > 0


async def _scope_revision_for_root(
    db: AsyncSession,
    root_task_id: str | None,
) -> tuple[str | None, int]:
    if root_task_id is None:
        return None, await _current_revision(db)
    global_revision = (
        select(TaskGraphState.revision)
        .where(TaskGraphState.scope_id == GLOBAL_TASK_GRAPH_SCOPE_ID)
        .scalar_subquery()
    )
    row = (
        await db.execute(
            select(
                Todo.project_id,
                func.coalesce(Project.graph_revision, global_revision),
            )
            .outerjoin(Project, Project.id == Todo.project_id)
            .where(Todo.id == root_task_id)
        )
    ).one_or_none()
    if row is None:
        # The scoped task loader supplies the public not-found error.
        return None, 0
    return row[0], row[1]


async def _current_revision(
    db: AsyncSession,
    project_id: str | None = None,
) -> int:
    if project_id is not None:
        revision = (
            await db.execute(
                select(Project.graph_revision).where(Project.id == project_id)
            )
        ).scalar_one_or_none()
        if revision is not None:
            return revision
    revision = (
        await db.execute(
            select(TaskGraphState.revision).where(
                TaskGraphState.scope_id == GLOBAL_TASK_GRAPH_SCOPE_ID
            )
        )
    ).scalar_one_or_none()
    return revision if revision is not None else 0


def _task_snapshot(row: object) -> _TaskSnapshot:
    task_id, title, status, parent_id, estimated_minutes, due_date = row  # type: ignore[misc]
    return _TaskSnapshot(
        id=task_id,
        title=title,
        status=TaskStatus(status),
        parent_id=parent_id,
        estimated_minutes=estimated_minutes,
        due_date=_utc(due_date),
    )


def _task_columns():
    return (
        Todo.id,
        Todo.title,
        Todo.status,
        Todo.parent_id,
        Todo.estimated_minutes,
        Todo.due_date,
    )


async def _load_scoped_tasks(
    db: AsyncSession,
    root_task_id: str | None,
    limit: int,
) -> tuple[list[_TaskSnapshot], set[str]]:
    if root_task_id is None:
        rows = list(
            (
                await db.execute(
                    select(*_task_columns()).order_by(Todo.id.asc()).limit(limit + 1)
                )
            ).all()
        )
        if len(rows) > limit:
            raise ValidationError(
                f"Task graph exceeds the requested limit of {limit} tasks",
                details={"limit": limit},
            )
        snapshots = [_task_snapshot(row) for row in rows]
        return snapshots, {task.id for task in snapshots}

    root_row = (
        await db.execute(
            select(*_task_columns()).where(Todo.id == root_task_id).limit(1)
        )
    ).one_or_none()
    if root_row is None:
        raise NotFoundError(f"Todo {root_task_id} not found")
    root = _task_snapshot(root_row)
    if root.parent_id is not None:
        raise ValidationError(
            "root_task_id must reference a root todo",
            details={"root_task_id": root_task_id, "parent_id": root.parent_id},
        )

    descendants = (
        select(Todo.id.label("id"))
        .where(Todo.id == root_task_id)
        .cte("graph_descendants", recursive=True)
    )
    descendants = descendants.union(
        select(Todo.id.label("id")).join(
            descendants,
            Todo.parent_id == descendants.c.id,
        )
    )
    descendant_rows = list(
        (
            await db.execute(
                select(descendants.c.id)
                .order_by(descendants.c.id.asc())
                .limit(limit + 1)
            )
        ).scalars()
    )
    if len(descendant_rows) > limit:
        raise ValidationError(
            f"Project graph exceeds the requested limit of {limit} tasks",
            details={"root_task_id": root_task_id, "limit": limit},
        )
    primary_ids = set(descendant_rows)

    graph_scope = select(descendants.c.id.label("id")).cte(
        "graph_scope",
        recursive=True,
    )
    graph_scope = graph_scope.union(
        select(TaskRelationship.target_task_id.label("id"))
        .join(
            graph_scope,
            TaskRelationship.source_task_id == graph_scope.c.id,
        )
        .where(TaskRelationship.type == TaskRelationshipType.DEPENDS_ON)
    )
    rows = list(
        (
            await db.execute(
                select(*_task_columns())
                .where(Todo.id.in_(select(graph_scope.c.id)))
                .order_by(Todo.id.asc())
                .limit(limit + 1)
            )
        ).all()
    )
    if len(rows) > limit:
        raise ValidationError(
            f"Project graph and prerequisite closure exceed {limit} tasks",
            details={"root_task_id": root_task_id, "limit": limit},
        )
    return [_task_snapshot(row) for row in rows], primary_ids


async def _load_snapshot(
    db: AsyncSession,
    root_task_id: str | None,
    limit: int,
) -> _GraphSnapshot | None:
    project_id, revision_before = await _scope_revision_for_root(db, root_task_id)
    tasks, primary_ids = await _load_scoped_tasks(db, root_task_id, limit)
    task_ids = {task.id for task in tasks}

    relationship_limit = min(_MAX_RELATIONSHIPS, max(limit * 10, limit))
    relationship_query = select(
        TaskRelationship.id,
        TaskRelationship.source_task_id,
        TaskRelationship.target_task_id,
    ).where(TaskRelationship.type == TaskRelationshipType.DEPENDS_ON)
    if root_task_id is not None:
        relationship_query = relationship_query.where(
            TaskRelationship.source_task_id.in_(task_ids)
        )
    relationship_rows = list(
        (
            await db.execute(
                relationship_query.order_by(TaskRelationship.id.asc()).limit(
                    relationship_limit + 1
                )
            )
        ).all()
    )
    if len(relationship_rows) > relationship_limit:
        raise ValidationError(
            f"Execution graph exceeds the relationship limit of {relationship_limit}",
            details={"relationship_limit": relationship_limit},
        )
    edges = tuple(
        _EdgeSnapshot(
            relationship_id=relationship_id,
            source_task_id=source_task_id,
            target_task_id=target_task_id,
        )
        for relationship_id, source_task_id, target_task_id in relationship_rows
    )

    container_ids: set[str] = set()
    if task_ids:
        container_ids = set(
            (
                await db.execute(
                    select(distinct(Todo.parent_id)).where(Todo.parent_id.in_(task_ids))
                )
            ).scalars()
        )
        container_ids.discard(None)  # type: ignore[arg-type]

    parent_ids = {task.parent_id for task in tasks if task.parent_id is not None}
    existing_parent_ids: set[str] = set()
    if parent_ids:
        existing_parent_ids = set(
            (
                await db.execute(select(Todo.id).where(Todo.id.in_(parent_ids)))
            ).scalars()
        )

    revision_after = await _current_revision(db, project_id)
    if revision_after != revision_before:
        return None
    return _GraphSnapshot(
        revision=revision_after,
        root_task_id=root_task_id,
        tasks=tuple(tasks),
        edges=edges,
        primary_ids=frozenset(primary_ids),
        container_ids=frozenset(container_ids),
        existing_parent_ids=frozenset(existing_parent_ids),
    )


def _strongly_connected_components(
    node_ids: set[str],
    adjacency: dict[str, set[str]],
) -> list[list[str]]:
    """Return cyclic SCCs using iterative Kosaraju traversal."""

    reverse: dict[str, set[str]] = defaultdict(set)
    for source_id in node_ids:
        for target_id in adjacency.get(source_id, set()):
            if target_id in node_ids:
                reverse[target_id].add(source_id)

    visited: set[str] = set()
    finish_order: list[str] = []
    for start_id in sorted(node_ids):
        if start_id in visited:
            continue
        visited.add(start_id)
        stack: list[tuple[str, bool]] = [(start_id, False)]
        while stack:
            node_id, expanded = stack.pop()
            if expanded:
                finish_order.append(node_id)
                continue
            stack.append((node_id, True))
            for target_id in sorted(adjacency.get(node_id, set()), reverse=True):
                if target_id in node_ids and target_id not in visited:
                    visited.add(target_id)
                    stack.append((target_id, False))

    components: list[list[str]] = []
    assigned: set[str] = set()
    for start_id in reversed(finish_order):
        if start_id in assigned:
            continue
        component: list[str] = []
        stack = [start_id]
        assigned.add(start_id)
        while stack:
            node_id = stack.pop()
            component.append(node_id)
            for target_id in sorted(reverse.get(node_id, set()), reverse=True):
                if target_id not in assigned:
                    assigned.add(target_id)
                    stack.append(target_id)
        component.sort()
        if len(component) > 1 or component[0] in adjacency.get(component[0], set()):
            components.append(component)
    return sorted(components, key=lambda component: component[0])


def _dependency_closure(
    task_id: str,
    blockers: dict[str, set[str]],
    tasks_by_id: dict[str, _TaskSnapshot],
) -> tuple[list[str], bool]:
    direct = blockers.get(task_id, set())
    discovered: set[str] = set()
    queue = deque(sorted(direct))
    while queue:
        blocker_id = queue.popleft()
        blocker = tasks_by_id.get(blocker_id)
        if blocker is None or blocker.status == TaskStatus.CANCELLED:
            continue
        for dependency_id in sorted(blockers.get(blocker_id, set())):
            if (
                dependency_id == task_id
                or dependency_id in direct
                or dependency_id in discovered
            ):
                continue
            discovered.add(dependency_id)
            if len(discovered) > _MAX_RELATED_TASK_IDS:
                return sorted(discovered)[:_MAX_RELATED_TASK_IDS], True
            queue.append(dependency_id)
    return sorted(discovered), False


def _downstream_closure(
    task_id: str,
    tasks_by_id: dict[str, _TaskSnapshot],
    dependents: dict[str, set[str]],
) -> tuple[list[str], bool]:
    if (
        task_id not in tasks_by_id
        or tasks_by_id[task_id].status == TaskStatus.COMPLETED
    ):
        return [], False
    discovered: set[str] = set()
    queue = deque(sorted(dependents.get(task_id, set())))
    while queue:
        dependent_id = queue.popleft()
        dependent = tasks_by_id.get(dependent_id)
        if dependent is None or dependent.status not in _ACTIVE_STATUSES:
            continue
        if dependent_id in discovered:
            continue
        discovered.add(dependent_id)
        if len(discovered) > _MAX_RELATED_TASK_IDS:
            return sorted(discovered)[:_MAX_RELATED_TASK_IDS], True
        queue.extend(sorted(dependents.get(dependent_id, set())))
    discovered.discard(task_id)
    return sorted(discovered), False


def _unschedulable_active_tasks(
    tasks_by_id: dict[str, _TaskSnapshot],
    dependency_ids: dict[str, set[str]],
    dependents: dict[str, set[str]],
    execution_cycle_ids: set[str],
) -> set[str]:
    """Propagate hard blockers through active dependents in O(V + E)."""

    unschedulable = {
        task_id
        for task_id, task in tasks_by_id.items()
        if task.status in _ACTIVE_STATUSES
        and (
            task_id in execution_cycle_ids
            or any(
                dependency_id not in tasks_by_id
                or tasks_by_id[dependency_id].status == TaskStatus.CANCELLED
                for dependency_id in dependency_ids.get(task_id, set())
            )
        )
    }
    queue = deque(sorted(unschedulable))
    while queue:
        blocker_id = queue.popleft()
        for dependent_id in sorted(dependents.get(blocker_id, set())):
            dependent = tasks_by_id.get(dependent_id)
            if (
                dependent is None
                or dependent.status not in _ACTIVE_STATUSES
                or dependent_id in unschedulable
            ):
                continue
            unschedulable.add(dependent_id)
            queue.append(dependent_id)
    return unschedulable


def _critical_path_data(
    tasks_by_id: dict[str, _TaskSnapshot],
    dependency_ids: dict[str, set[str]],
    container_ids: set[str],
    primary_ids: set[str],
    execution_cycle_ids: set[str],
    unschedulable_ids: set[str],
) -> tuple[
    list[str],
    int | None,
    int,
    bool,
    list[str],
    dict[str, int],
    dict[str, bool],
]:
    all_active_ids = {
        task_id
        for task_id, task in tasks_by_id.items()
        if task.status in _ACTIVE_STATUSES
    }
    # Only work that can reach an active primary task belongs to the scoped
    # critical path. A completed/cancelled prerequisite is a cut point, so an
    # active ancestor behind it cannot make this project's estimate unknown.
    active_ids: set[str] = set()
    queue = deque(sorted(all_active_ids.intersection(primary_ids)))
    while queue:
        task_id = queue.popleft()
        if task_id in active_ids:
            continue
        active_ids.add(task_id)
        for dependency_id in sorted(dependency_ids.get(task_id, set())):
            if dependency_id in all_active_ids and dependency_id not in active_ids:
                queue.append(dependency_id)

    gating_container_ids = {
        dependency_id
        for task_id in active_ids
        for dependency_id in dependency_ids.get(task_id, set())
        if dependency_id in container_ids and dependency_id in active_ids
    }
    unknown_ids = sorted(
        task_id
        for task_id in active_ids
        if (
            task_id in gating_container_ids
            or (
                task_id not in container_ids
                and not _has_valid_estimate(
                    tasks_by_id[task_id].estimated_minutes
                )
            )
        )
    )
    if execution_cycle_ids.intersection(active_ids):
        return [], None, 0, False, unknown_ids, {}, {}

    active_dependencies = {
        task_id: {
            dependency_id
            for dependency_id in dependency_ids.get(task_id, set())
            if dependency_id in active_ids
        }
        for task_id in active_ids
    }
    active_dependents: dict[str, set[str]] = defaultdict(set)
    in_degree = {
        task_id: len(active_dependencies[task_id]) for task_id in active_ids
    }
    for task_id, dependencies in active_dependencies.items():
        for dependency_id in dependencies:
            active_dependents[dependency_id].add(task_id)

    ready = [task_id for task_id, degree in in_degree.items() if degree == 0]
    heapq.heapify(ready)
    topo_order: list[str] = []
    while ready:
        task_id = heapq.heappop(ready)
        topo_order.append(task_id)
        for dependent_id in sorted(active_dependents.get(task_id, set())):
            in_degree[dependent_id] -= 1
            if in_degree[dependent_id] == 0:
                heapq.heappush(ready, dependent_id)

    if len(topo_order) != len(active_ids):
        return [], None, 0, False, unknown_ids, {}, {}

    known_minutes: dict[str, int] = {}
    estimates_complete: dict[str, bool] = {}
    predecessor: dict[str, str | None] = {}
    for task_id in topo_order:
        task = tasks_by_id[task_id]
        if task_id in container_ids:
            own_known_minutes = 0
            # A structural container is normally a zero-weight aggregate. If
            # another task explicitly depends on that container, however, the
            # current model has no deterministic rule for when its children
            # make the container complete. Keep that gate provisional.
            own_complete = task_id not in gating_container_ids
        elif _has_valid_estimate(task.estimated_minutes):
            assert task.estimated_minutes is not None
            own_known_minutes = task.estimated_minutes
            own_complete = True
        else:
            own_known_minutes = 0
            own_complete = False

        candidates = sorted(active_dependencies[task_id])
        selected = (
            min(
                candidates,
                key=lambda dependency_id: (
                    -known_minutes[dependency_id],
                    dependency_id,
                ),
            )
            if candidates
            else None
        )
        prerequisite_minutes = known_minutes[selected] if selected is not None else 0
        known_minutes[task_id] = own_known_minutes + prerequisite_minutes
        estimates_complete[task_id] = (
            task_id not in unschedulable_ids
            and own_complete
            and all(
                estimates_complete[dependency_id]
                for dependency_id in candidates
            )
        )
        predecessor[task_id] = selected

    primary_active_ids = active_ids & primary_ids
    endpoints = sorted(primary_active_ids - container_ids)
    if not endpoints:
        endpoints = sorted(primary_active_ids)
    if not endpoints:
        return [], 0, 0, True, [], known_minutes, estimates_complete
    endpoint = min(
        endpoints,
        key=lambda task_id: (-known_minutes[task_id], task_id),
    )
    path: list[str] = []
    cursor: str | None = endpoint
    while cursor is not None:
        path.append(cursor)
        cursor = predecessor[cursor]
    path.reverse()

    relevant_unknown_ids = sorted(active_ids.intersection(unknown_ids))
    has_unschedulable_primary = bool(
        unschedulable_ids.intersection(primary_ids).intersection(active_ids)
    )
    graph_estimate_complete = (
        not relevant_unknown_ids and not has_unschedulable_primary
    )
    known_total = known_minutes[endpoint]
    exact_total = known_total if graph_estimate_complete else None
    return (
        path,
        exact_total,
        known_total,
        graph_estimate_complete,
        relevant_unknown_ids,
        known_minutes,
        estimates_complete,
    )


def _role_for(
    task_id: str,
    root_task_id: str | None,
    primary_ids: set[str],
) -> GraphScopeRole:
    if root_task_id is None:
        return GraphScopeRole.GLOBAL
    if task_id == root_task_id:
        return GraphScopeRole.ROOT
    if task_id in primary_ids:
        return GraphScopeRole.DESCENDANT
    return GraphScopeRole.CONTEXT


def _execution_state(
    task: _TaskSnapshot,
    *,
    is_ready: bool,
    is_blocked: bool,
) -> GraphExecutionState:
    if task.status == TaskStatus.COMPLETED:
        return GraphExecutionState.COMPLETED
    if task.status == TaskStatus.CANCELLED:
        return GraphExecutionState.CANCELLED
    if task.status == TaskStatus.IN_PROGRESS:
        return GraphExecutionState.IN_PROGRESS
    if is_blocked:
        return GraphExecutionState.BLOCKED
    if is_ready:
        return GraphExecutionState.READY
    return GraphExecutionState.PENDING


def _analyze_snapshot(
    snapshot: _GraphSnapshot,
    *,
    generated_at: datetime,
) -> GraphInsightsResponse:
    generated_at = _utc(generated_at) or datetime.now(timezone.utc)
    tasks_by_id = {task.id: task for task in snapshot.tasks}
    task_ids = set(tasks_by_id)
    primary_ids = set(snapshot.primary_ids)
    if snapshot.root_task_id is None:
        primary_ids = set(task_ids)

    issues: list[GraphInsightIssue] = []
    dependency_ids: dict[str, set[str]] = defaultdict(set)
    dependents: dict[str, set[str]] = defaultdict(set)
    seen_edges: set[tuple[str, str]] = set()
    missing_endpoint_ids: set[str] = set()
    self_edge_ids: set[str] = set()
    duplicate_edge_ids: set[str] = set()

    for edge in snapshot.edges:
        source_exists = edge.source_task_id in task_ids
        target_exists = edge.target_task_id in task_ids
        if not source_exists or not target_exists:
            missing = [
                task_id
                for task_id, exists in (
                    (edge.source_task_id, source_exists),
                    (edge.target_task_id, target_exists),
                )
                if not exists
            ]
            missing_endpoint_ids.update(missing)
            issues.append(
                GraphInsightIssue(
                    code=GraphIssueCode.MISSING_DEPENDENCY,
                    severity=GraphIssueSeverity.ERROR,
                    task_ids=[edge.source_task_id] if source_exists else [],
                    related_task_ids=missing,
                    message="Dependency relationship references a missing task",
                )
            )
        if not source_exists:
            continue

        dependency_ids[edge.source_task_id].add(edge.target_task_id)
        dependents[edge.target_task_id].add(edge.source_task_id)
        edge_key = (edge.source_task_id, edge.target_task_id)
        if edge.source_task_id == edge.target_task_id:
            self_edge_ids.add(edge.relationship_id)
            issues.append(
                GraphInsightIssue(
                    code=GraphIssueCode.SELF_DEPENDENCY,
                    severity=GraphIssueSeverity.ERROR,
                    task_ids=[edge.source_task_id],
                    message="Task depends on itself",
                )
            )
        if edge_key in seen_edges:
            duplicate_edge_ids.add(edge.relationship_id)
            issues.append(
                GraphInsightIssue(
                    code=GraphIssueCode.DUPLICATE_DEPENDENCY,
                    severity=GraphIssueSeverity.ERROR,
                    task_ids=[edge.source_task_id],
                    related_task_ids=[edge.target_task_id],
                    message="Duplicate dependency relationship detected",
                )
            )
        seen_edges.add(edge_key)

    blockers: dict[str, set[str]] = defaultdict(set)
    cancelled_prerequisite_edges: set[tuple[str, str]] = set()
    for task_id in task_ids:
        for dependency_id in dependency_ids.get(task_id, set()):
            dependency = tasks_by_id.get(dependency_id)
            if dependency is None or dependency.status != TaskStatus.COMPLETED:
                blockers[task_id].add(dependency_id)
            if dependency is not None and dependency.status == TaskStatus.CANCELLED:
                cancelled_prerequisite_edges.add((task_id, dependency_id))
                issues.append(
                    GraphInsightIssue(
                        code=GraphIssueCode.CANCELLED_PREREQUISITE,
                        severity=GraphIssueSeverity.WARNING,
                        task_ids=[task_id],
                        related_task_ids=[dependency_id],
                        message="Task depends on a cancelled prerequisite",
                    )
                )

    dependency_adjacency = {
        task_id: {
            dependency_id
            for dependency_id in dependencies
            if dependency_id in task_ids
        }
        for task_id, dependencies in dependency_ids.items()
    }
    dependency_cycles = _strongly_connected_components(
        task_ids,
        dependency_adjacency,
    )
    for component in dependency_cycles:
        issues.append(
            GraphInsightIssue(
                code=GraphIssueCode.DEPENDENCY_CYCLE,
                severity=GraphIssueSeverity.ERROR,
                task_ids=component,
                message="Dependency cycle detected",
            )
        )

    # Graph health describes every persisted cycle, including historical
    # cycles that pass through a completed task. Execution semantics are
    # narrower: completed prerequisites release their dependents and are cut
    # from the runnable graph. Only an SCC made entirely of active tasks can
    # make the current schedule cyclic. Cancelled prerequisites remain hard
    # blockers independently of SCC membership.
    active_task_ids = {
        task_id
        for task_id, task in tasks_by_id.items()
        if task.status in _ACTIVE_STATUSES
    }
    execution_adjacency = {
        task_id: {
            dependency_id
            for dependency_id in dependency_ids.get(task_id, set())
            if dependency_id in active_task_ids
        }
        for task_id in active_task_ids
    }
    execution_cycles = _strongly_connected_components(
        active_task_ids,
        execution_adjacency,
    )
    execution_cycle_ids = {
        task_id for component in execution_cycles for task_id in component
    }

    parent_adjacency = {
        task.id: {task.parent_id}
        for task in snapshot.tasks
        if task.parent_id in task_ids
    }
    parent_cycles = _strongly_connected_components(task_ids, parent_adjacency)
    for component in parent_cycles:
        issues.append(
            GraphInsightIssue(
                code=GraphIssueCode.PARENT_CYCLE,
                severity=GraphIssueSeverity.ERROR,
                task_ids=component,
                message="Structural parent cycle detected",
            )
        )

    missing_parent_task_ids = sorted(
        task.id
        for task in snapshot.tasks
        if task.parent_id is not None
        and task.parent_id not in snapshot.existing_parent_ids
    )
    for task_id in missing_parent_task_ids:
        parent_id = tasks_by_id[task_id].parent_id
        issues.append(
            GraphInsightIssue(
                code=GraphIssueCode.MISSING_PARENT,
                severity=GraphIssueSeverity.ERROR,
                task_ids=[task_id],
                related_task_ids=[parent_id] if parent_id is not None else [],
                message="Task references a missing structural parent",
            )
        )

    invalid_estimate_task_ids = sorted(
        task.id
        for task in snapshot.tasks
        if task.id not in snapshot.container_ids
        and task.estimated_minutes is not None
        and not _has_valid_estimate(task.estimated_minutes)
    )
    for task_id in invalid_estimate_task_ids:
        issues.append(
            GraphInsightIssue(
                code=GraphIssueCode.INVALID_ESTIMATE,
                severity=GraphIssueSeverity.WARNING,
                task_ids=[task_id],
                message="Leaf task estimate must be greater than zero",
            )
        )

    due_date_conflicts: set[tuple[str, str]] = set()
    for task_id, dependencies in dependency_ids.items():
        task = tasks_by_id.get(task_id)
        if (
            task is None
            or task.status not in _ACTIVE_STATUSES
            or task.due_date is None
        ):
            continue
        for dependency_id in dependencies:
            dependency = tasks_by_id.get(dependency_id)
            if (
                dependency is not None
                and dependency.status in _ACTIVE_STATUSES
                and dependency.due_date is not None
                and dependency.due_date > task.due_date
            ):
                due_date_conflicts.add((task_id, dependency_id))
                issues.append(
                    GraphInsightIssue(
                        code=GraphIssueCode.DUE_DATE_CONFLICT,
                        severity=GraphIssueSeverity.WARNING,
                        task_ids=[task_id],
                        related_task_ids=[dependency_id],
                        message="Prerequisite is due after its dependent task",
                    )
                )

    for task in snapshot.tasks:
        if (
            task.status not in _ACTIVE_STATUSES
            or task.parent_id is None
            or task.due_date is None
        ):
            continue
        parent = tasks_by_id.get(task.parent_id)
        if (
            parent is not None
            and parent.status in _ACTIVE_STATUSES
            and parent.due_date is not None
            and task.due_date > parent.due_date
        ):
            due_date_conflicts.add((parent.id, task.id))
            issues.append(
                GraphInsightIssue(
                    code=GraphIssueCode.DUE_DATE_CONFLICT,
                    severity=GraphIssueSeverity.WARNING,
                    task_ids=[parent.id],
                    related_task_ids=[task.id],
                    message="Child task is due after its parent container",
                )
            )

    for task in snapshot.tasks:
        task_blockers = blockers.get(task.id, set())
        if task.status == TaskStatus.IN_PROGRESS and task_blockers:
            issues.append(
                GraphInsightIssue(
                    code=GraphIssueCode.LIFECYCLE_CONFLICT,
                    severity=GraphIssueSeverity.WARNING,
                    task_ids=[task.id],
                    related_task_ids=sorted(task_blockers),
                    message="In-progress task still has incomplete prerequisites",
                )
            )
        if task.status == TaskStatus.COMPLETED and task_blockers:
            issues.append(
                GraphInsightIssue(
                    code=GraphIssueCode.LIFECYCLE_CONFLICT,
                    severity=GraphIssueSeverity.WARNING,
                    task_ids=[task.id],
                    related_task_ids=sorted(task_blockers),
                    message="Completed task has incomplete prerequisites",
                )
            )

    unschedulable_ids = _unschedulable_active_tasks(
        tasks_by_id,
        dependency_ids,
        dependents,
        execution_cycle_ids,
    )
    (
        critical_path_ids,
        critical_path_minutes,
        critical_path_known_minutes,
        critical_path_estimate_complete,
        unknown_estimate_ids,
        remaining_known_minutes,
        remaining_estimates_complete,
    ) = _critical_path_data(
        tasks_by_id,
        dependency_ids,
        set(snapshot.container_ids),
        primary_ids,
        execution_cycle_ids,
        unschedulable_ids,
    )
    critical_path_set = set(critical_path_ids)

    transitive_blockers_by_id = {
        task_id: _dependency_closure(task_id, blockers, tasks_by_id)
        for task_id in task_ids
    }
    downstream_by_id = {
        task_id: _downstream_closure(task_id, tasks_by_id, dependents)
        for task_id in task_ids
    }
    project_unschedulable = bool(primary_ids.intersection(unschedulable_ids))

    nodes: list[GraphInsightNode] = []
    for task_id in sorted(task_ids):
        task = tasks_by_id[task_id]
        direct_blockers = sorted(blockers.get(task_id, set()))
        transitive_blockers, transitive_blockers_truncated = (
            transitive_blockers_by_id[task_id]
        )
        downstream_ids, downstream_truncated = downstream_by_id[task_id]
        is_active = task.status in _ACTIVE_STATUSES
        is_blocked = is_active and bool(direct_blockers)
        is_unschedulable = is_active and task_id in unschedulable_ids
        is_container = task_id in snapshot.container_ids
        is_ready = (
            task.status == TaskStatus.PENDING
            and not is_container
            and not is_blocked
        )

        known_minutes = remaining_known_minutes.get(task_id, 0)
        if is_active and task_id not in remaining_known_minutes:
            # Context behind a completed/cancelled cut point does not
            # participate in the project critical path. Still avoid claiming
            # an exact zero for that context node itself.
            if is_container:
                estimate_complete = not dependents.get(task_id)
            elif _has_valid_estimate(task.estimated_minutes):
                assert task.estimated_minutes is not None
                known_minutes = task.estimated_minutes
                estimate_complete = not any(
                    dependency_id in tasks_by_id
                    and tasks_by_id[dependency_id].status in _ACTIVE_STATUSES
                    for dependency_id in dependency_ids.get(task_id, set())
                )
            else:
                estimate_complete = False
        else:
            estimate_complete = (
                remaining_estimates_complete.get(task_id, True)
                if is_active
                else True
            )
        if is_unschedulable:
            estimate_complete = False
        if is_active and is_container and task_id != snapshot.root_task_id:
            # Structural containers have no persisted completion rule tying
            # their descendants to the container itself. The project root can
            # use the scoped aggregate below; every nested/context container
            # must fail closed instead of advertising an exact zero-minute
            # remaining path or a confident deadline.
            estimate_complete = False
        if task_id == snapshot.root_task_id and is_container:
            # The inferred project root is a structural aggregate. Its own
            # estimate must not hide a longer child execution path when
            # assessing the project deadline.
            known_minutes = critical_path_known_minutes
            estimate_complete = critical_path_estimate_complete
        exact_minutes = known_minutes if estimate_complete else None
        due_risk = GraphDueRisk.NONE
        due_slack_minutes: int | None = None
        if is_active and task.due_date is not None:
            available_minutes = int(
                (task.due_date - generated_at).total_seconds() // 60
            )
            if task.due_date < generated_at:
                due_risk = GraphDueRisk.OVERDUE
            elif is_unschedulable or (
                task_id == snapshot.root_task_id and project_unschedulable
            ):
                due_risk = GraphDueRisk.BLOCKED
            elif not estimate_complete:
                due_risk = GraphDueRisk.UNKNOWN_ESTIMATE
            else:
                due_slack_minutes = available_minutes - known_minutes
                if due_slack_minutes < 0:
                    due_risk = GraphDueRisk.INSUFFICIENT_TIME

        nodes.append(
            GraphInsightNode(
                task_id=task_id,
                title=task.title,
                status=task.status,
                parent_id=task.parent_id,
                scope_role=_role_for(task_id, snapshot.root_task_id, primary_ids),
                execution_state=_execution_state(
                    task,
                    is_ready=is_ready,
                    is_blocked=is_blocked,
                ),
                estimated_minutes=task.estimated_minutes,
                due_date=task.due_date,
                dependency_ids=sorted(dependency_ids.get(task_id, set())),
                direct_blocker_ids=direct_blockers,
                transitive_blocker_ids=transitive_blockers,
                transitive_blocker_count=(
                    len(transitive_blockers)
                    + (1 if transitive_blockers_truncated else 0)
                ),
                transitive_blockers_truncated=transitive_blockers_truncated,
                downstream_task_ids=downstream_ids,
                downstream_count=(
                    len(downstream_ids) + (1 if downstream_truncated else 0)
                ),
                downstream_truncated=downstream_truncated,
                is_container=is_container,
                is_ready=is_ready,
                is_blocked=is_blocked,
                is_unschedulable=is_unschedulable,
                is_on_critical_path=task_id in critical_path_set,
                remaining_path_minutes=exact_minutes,
                remaining_path_known_minutes=known_minutes,
                estimate_complete=estimate_complete,
                due_risk=due_risk,
                due_slack_minutes=due_slack_minutes,
            )
        )

    primary_nodes = [node for node in nodes if node.task_id in primary_ids]
    active_primary_nodes = [
        node for node in primary_nodes if node.status in _ACTIVE_STATUSES
    ]
    isolated_ids = {
        task_id
        for task_id in primary_ids
        if task_id in tasks_by_id
        and tasks_by_id[task_id].status in _ACTIVE_STATUSES
        and tasks_by_id[task_id].parent_id not in primary_ids
        and task_id not in snapshot.container_ids
        and not dependency_ids.get(task_id)
        and not dependents.get(task_id)
    }
    at_risk_values = {
        GraphDueRisk.OVERDUE,
        GraphDueRisk.BLOCKED,
        GraphDueRisk.INSUFFICIENT_TIME,
    }
    error_issues = [
        issue for issue in issues if issue.severity == GraphIssueSeverity.ERROR
    ]
    primary_missing_parent_ids = primary_ids.intersection(missing_parent_task_ids)
    primary_unschedulable_ids = sorted(
        primary_ids.intersection(unschedulable_ids)
    )
    summary = GraphInsightSummary(
        active_count=len(active_primary_nodes),
        pending_count=sum(node.status == TaskStatus.PENDING for node in primary_nodes),
        in_progress_count=sum(
            node.status == TaskStatus.IN_PROGRESS for node in primary_nodes
        ),
        completed_count=sum(
            node.status == TaskStatus.COMPLETED for node in primary_nodes
        ),
        cancelled_count=sum(
            node.status == TaskStatus.CANCELLED for node in primary_nodes
        ),
        ready_count=sum(node.is_ready for node in primary_nodes),
        blocked_count=sum(node.is_blocked for node in active_primary_nodes),
        at_risk_count=sum(
            node.due_risk in at_risk_values for node in active_primary_nodes
        ),
        overdue_count=sum(
            node.due_risk == GraphDueRisk.OVERDUE for node in active_primary_nodes
        ),
        orphan_count=len(primary_missing_parent_ids),
        isolated_count=len(isolated_ids),
        critical_path_task_ids=critical_path_ids,
        critical_path_minutes=critical_path_minutes,
        critical_path_known_minutes=critical_path_known_minutes,
        critical_path_estimate_complete=critical_path_estimate_complete,
        unknown_estimate_task_ids=unknown_estimate_ids,
        unschedulable_task_ids=primary_unschedulable_ids,
        unschedulable_count=len(primary_unschedulable_ids),
        cycle_count=len(dependency_cycles),
        missing_dependency_count=len(missing_endpoint_ids),
        due_date_conflict_count=len(due_date_conflicts),
        unknown_estimate_count=len(unknown_estimate_ids),
        invalid_estimate_count=len(invalid_estimate_task_ids),
        parent_cycle_count=len(parent_cycles),
        missing_parent_count=len(primary_missing_parent_ids),
        cancelled_prerequisite_count=len(cancelled_prerequisite_edges),
        issue_count=len(issues),
        is_healthy=not error_issues,
    )
    context_count = len(task_ids - primary_ids)
    return GraphInsightsResponse(
        graph_revision=snapshot.revision,
        generated_at=generated_at,
        scope=GraphInsightScope(
            root_task_id=snapshot.root_task_id,
            task_count=len(task_ids),
            primary_task_count=len(primary_ids),
            relationship_count=len(snapshot.edges),
            prerequisite_task_count=context_count,
        ),
        nodes=nodes,
        summary=summary,
        issues=issues[:_MAX_ISSUES],
        issues_truncated=len(issues) > _MAX_ISSUES,
    )


async def get_graph_insights(
    db: AsyncSession,
    *,
    root_task_id: str | None = None,
    limit: int = DEFAULT_GRAPH_INSIGHT_LIMIT,
    generated_at: datetime | None = None,
) -> GraphInsightsResponse:
    """Read a revision-consistent snapshot and derive bounded graph insights."""

    if limit < 1 or limit > MAX_GRAPH_INSIGHT_LIMIT:
        raise ValidationError(
            f"limit must be between 1 and {MAX_GRAPH_INSIGHT_LIMIT}"
        )
    as_of = _utc(generated_at) or datetime.now(timezone.utc)
    for attempt in range(_SNAPSHOT_ATTEMPTS):
        snapshot = await _load_snapshot(db, root_task_id, limit)
        if snapshot is not None:
            return _analyze_snapshot(snapshot, generated_at=as_of)
        if attempt + 1 < _SNAPSHOT_ATTEMPTS:
            await db.rollback()
    raise ConflictError(
        "Task graph changed repeatedly while computing insights; retry the request"
    )
