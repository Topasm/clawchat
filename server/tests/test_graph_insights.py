"""Deterministic execution-graph insight coverage."""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from domain.graph_insights import GraphDueRisk, GraphScopeRole
from domain.plan_proposal import GLOBAL_TASK_GRAPH_SCOPE_ID
from domain.task import TaskStatus
from domain.task_relationship import TaskRelationshipType
from exceptions import ConflictError
from models.task_graph_state import TaskGraphState
from models.task_relationship import TaskRelationship
from models.todo import Todo
import services.graph_insights_service as graph_insights_service
from services.graph_insights_service import (
    _analyze_snapshot,
    _EdgeSnapshot,
    _GraphSnapshot,
    _TaskSnapshot,
    get_graph_insights,
)
from sqlalchemy import event


def _todo(
    task_id: str,
    *,
    status: TaskStatus = TaskStatus.PENDING,
    parent_id: str | None = None,
    estimated_minutes: int | None = 10,
    due_date: datetime | None = None,
) -> Todo:
    return Todo(
        id=task_id,
        title=task_id.replace("todo_", "").replace("_", " ").title(),
        status=status,
        parent_id=parent_id,
        estimated_minutes=estimated_minutes,
        due_date=due_date,
    )


def _dependency(source_task_id: str, target_task_id: str) -> TaskRelationship:
    return TaskRelationship(
        id=f"rel_{source_task_id}_{target_task_id}",
        source_task_id=source_task_id,
        target_task_id=target_task_id,
        type=TaskRelationshipType.DEPENDS_ON,
    )


def _nodes_by_id(response):
    return {node.task_id: node for node in response.nodes}


def _snapshot(*, revision: int = 1) -> _GraphSnapshot:
    task = _TaskSnapshot(
        id="todo_task",
        title="Task",
        status=TaskStatus.PENDING,
        parent_id=None,
        estimated_minutes=10,
        due_date=None,
    )
    return _GraphSnapshot(
        revision=revision,
        root_task_id=None,
        tasks=(task,),
        edges=(),
        primary_ids=frozenset({task.id}),
        container_ids=frozenset(),
        existing_parent_ids=frozenset(),
    )


@pytest.mark.asyncio
async def test_snapshot_revision_change_retries_before_analysis(monkeypatch):
    db = AsyncMock()
    loader = AsyncMock(side_effect=[None, _snapshot(revision=9)])
    monkeypatch.setattr(graph_insights_service, "_load_snapshot", loader)

    response = await get_graph_insights(db)

    assert response.graph_revision == 9
    assert loader.await_count == 2
    db.rollback.assert_awaited_once()


@pytest.mark.asyncio
async def test_snapshot_revision_churn_fails_after_bounded_retries(monkeypatch):
    db = AsyncMock()
    loader = AsyncMock(return_value=None)
    monkeypatch.setattr(graph_insights_service, "_load_snapshot", loader)

    with pytest.raises(ConflictError, match="changed repeatedly"):
        await get_graph_insights(db)

    assert loader.await_count == 3
    assert db.rollback.await_count == 2


def test_critical_path_ties_use_stable_task_id_order():
    first = _TaskSnapshot(
        id="todo_a",
        title="First",
        status=TaskStatus.PENDING,
        parent_id=None,
        estimated_minutes=10,
        due_date=None,
    )
    second = _TaskSnapshot(
        id="todo_b",
        title="Second",
        status=TaskStatus.PENDING,
        parent_id=None,
        estimated_minutes=10,
        due_date=None,
    )
    final = _TaskSnapshot(
        id="todo_final",
        title="Final",
        status=TaskStatus.PENDING,
        parent_id=None,
        estimated_minutes=5,
        due_date=None,
    )
    snapshot = _GraphSnapshot(
        revision=2,
        root_task_id=None,
        tasks=(second, final, first),
        edges=(
            _EdgeSnapshot("rel_final_b", final.id, second.id),
            _EdgeSnapshot("rel_final_a", final.id, first.id),
        ),
        primary_ids=frozenset({first.id, second.id, final.id}),
        container_ids=frozenset(),
        existing_parent_ids=frozenset(),
    )

    response = _analyze_snapshot(
        snapshot,
        generated_at=datetime(2026, 8, 27, tzinfo=timezone.utc),
    )

    assert response.summary.critical_path_task_ids == [first.id, final.id]
    assert response.summary.critical_path_minutes == 15


def test_terminal_tasks_do_not_create_actionable_due_date_conflicts():
    completed = _TaskSnapshot(
        id="todo_completed",
        title="Completed",
        status=TaskStatus.COMPLETED,
        parent_id=None,
        estimated_minutes=10,
        due_date=datetime(2026, 8, 27, tzinfo=timezone.utc),
    )
    active_dependency = _TaskSnapshot(
        id="todo_active_dependency",
        title="Active dependency",
        status=TaskStatus.PENDING,
        parent_id=None,
        estimated_minutes=10,
        due_date=datetime(2026, 8, 28, tzinfo=timezone.utc),
    )
    snapshot = _GraphSnapshot(
        revision=3,
        root_task_id=None,
        tasks=(completed, active_dependency),
        edges=(
            _EdgeSnapshot(
                "rel_completed_dependency",
                completed.id,
                active_dependency.id,
            ),
        ),
        primary_ids=frozenset({completed.id, active_dependency.id}),
        container_ids=frozenset(),
        existing_parent_ids=frozenset(),
    )

    response = _analyze_snapshot(
        snapshot,
        generated_at=datetime(2026, 8, 27, tzinfo=timezone.utc),
    )

    assert response.summary.due_date_conflict_count == 0
    assert all(issue.code.value != "due_date_conflict" for issue in response.issues)


@pytest.mark.asyncio
async def test_root_scope_includes_external_prerequisites_and_primary_counts(
    db_session,
):
    root = _todo("todo_root", estimated_minutes=999)
    completed = _todo(
        "todo_completed",
        parent_id=root.id,
        status=TaskStatus.COMPLETED,
        estimated_minutes=20,
    )
    ready = _todo("todo_ready", parent_id=root.id, estimated_minutes=30)
    blocked = _todo("todo_blocked", parent_id=root.id, estimated_minutes=20)
    cross_root = _todo("todo_external", estimated_minutes=10)
    cross_root_blocked = _todo(
        "todo_cross_root_blocked",
        parent_id=root.id,
        estimated_minutes=15,
    )
    state = await db_session.get(TaskGraphState, GLOBAL_TASK_GRAPH_SCOPE_ID)
    assert state is not None
    state.revision = 7
    db_session.add_all(
        [
            root,
            completed,
            ready,
            blocked,
            cross_root,
            cross_root_blocked,
        ]
    )
    await db_session.flush()
    db_session.add_all(
        [
            _dependency(ready.id, completed.id),
            _dependency(blocked.id, ready.id),
            _dependency(cross_root_blocked.id, cross_root.id),
        ]
    )
    await db_session.commit()
    await db_session.refresh(state)
    expected_revision = state.revision

    response = await get_graph_insights(
        db_session,
        root_task_id=root.id,
        generated_at=datetime(2026, 8, 27, tzinfo=timezone.utc),
    )
    nodes = _nodes_by_id(response)

    assert response.graph_revision == expected_revision
    assert response.scope.task_count == 6
    assert response.scope.primary_task_count == 5
    assert response.scope.prerequisite_task_count == 1
    assert nodes[root.id].scope_role == GraphScopeRole.ROOT
    assert nodes[cross_root.id].scope_role == GraphScopeRole.CONTEXT
    assert nodes[root.id].is_container is True
    assert nodes[root.id].is_ready is False
    assert nodes[ready.id].is_ready is True
    assert nodes[blocked.id].direct_blocker_ids == [ready.id]
    assert nodes[cross_root_blocked.id].direct_blocker_ids == [cross_root.id]
    assert nodes[cross_root.id].downstream_task_ids == [cross_root_blocked.id]
    assert response.summary.ready_count == 1
    assert response.summary.blocked_count == 2
    assert response.summary.critical_path_task_ids == [ready.id, blocked.id]
    assert response.summary.critical_path_minutes == 50
    assert response.summary.critical_path_estimate_complete is True


@pytest.mark.asyncio
async def test_blocker_and_downstream_closures_are_deduplicated_and_stop_at_terminal(
    db_session,
):
    root = _todo("todo_root")
    first = _todo("todo_first", parent_id=root.id)
    left = _todo("todo_left", parent_id=root.id)
    right = _todo("todo_right", parent_id=root.id)
    final = _todo("todo_final", parent_id=root.id)
    db_session.add_all([root, first, left, right, final])
    await db_session.flush()
    db_session.add_all(
        [
            _dependency(left.id, first.id),
            _dependency(right.id, first.id),
            _dependency(final.id, left.id),
            _dependency(final.id, right.id),
        ]
    )
    await db_session.commit()

    response = await get_graph_insights(db_session, root_task_id=root.id)
    nodes = _nodes_by_id(response)
    assert nodes[final.id].direct_blocker_ids == [left.id, right.id]
    assert nodes[final.id].transitive_blocker_ids == [first.id]
    assert nodes[first.id].downstream_task_ids == [final.id, left.id, right.id]

    left.status = TaskStatus.COMPLETED
    await db_session.commit()
    response = await get_graph_insights(db_session, root_task_id=root.id)
    nodes = _nodes_by_id(response)
    assert nodes[final.id].direct_blocker_ids == [right.id]
    assert nodes[final.id].transitive_blocker_ids == [first.id]
    assert nodes[first.id].downstream_task_ids == [final.id, right.id]


@pytest.mark.asyncio
async def test_status_and_due_risk_are_conservative(db_session):
    now = datetime(2026, 8, 27, 12, 0, tzinfo=timezone.utc)
    root = _todo("todo_root")
    cancelled = _todo(
        "todo_cancelled",
        parent_id=root.id,
        status=TaskStatus.CANCELLED,
    )
    cancelled_blocked = _todo(
        "todo_cancelled_blocked",
        parent_id=root.id,
        due_date=now + timedelta(hours=2),
    )
    in_progress = _todo(
        "todo_in_progress",
        parent_id=root.id,
        status=TaskStatus.IN_PROGRESS,
    )
    unknown = _todo(
        "todo_unknown",
        parent_id=root.id,
        estimated_minutes=None,
        due_date=now + timedelta(hours=2),
    )
    invalid = _todo(
        "todo_invalid",
        parent_id=root.id,
        estimated_minutes=0,
        due_date=now + timedelta(hours=2),
    )
    exact = _todo(
        "todo_exact",
        parent_id=root.id,
        estimated_minutes=30,
        due_date=(now + timedelta(minutes=30)).replace(tzinfo=None),
    )
    late = _todo(
        "todo_late",
        parent_id=root.id,
        estimated_minutes=30,
        due_date=now + timedelta(minutes=29),
    )
    overdue = _todo(
        "todo_overdue",
        parent_id=root.id,
        estimated_minutes=1,
        due_date=now - timedelta(minutes=1),
    )
    db_session.add_all(
        [
            root,
            cancelled,
            cancelled_blocked,
            in_progress,
            unknown,
            invalid,
            exact,
            late,
            overdue,
        ]
    )
    await db_session.flush()
    db_session.add(_dependency(cancelled_blocked.id, cancelled.id))
    await db_session.commit()

    response = await get_graph_insights(
        db_session,
        root_task_id=root.id,
        generated_at=now,
    )
    nodes = _nodes_by_id(response)

    assert nodes[cancelled.id].is_ready is False
    assert nodes[cancelled.id].is_blocked is False
    assert nodes[cancelled.id].downstream_task_ids == [cancelled_blocked.id]
    assert nodes[cancelled_blocked.id].is_blocked is True
    assert nodes[cancelled_blocked.id].is_unschedulable is True
    assert nodes[cancelled_blocked.id].remaining_path_minutes is None
    assert nodes[cancelled_blocked.id].due_risk == GraphDueRisk.BLOCKED
    assert nodes[in_progress.id].is_ready is False
    assert nodes[in_progress.id].is_blocked is False
    assert nodes[unknown.id].remaining_path_minutes is None
    assert nodes[unknown.id].due_risk == GraphDueRisk.UNKNOWN_ESTIMATE
    assert nodes[invalid.id].due_risk == GraphDueRisk.UNKNOWN_ESTIMATE
    assert nodes[exact.id].due_slack_minutes == 0
    assert nodes[exact.id].due_risk == GraphDueRisk.NONE
    assert nodes[late.id].due_slack_minutes == -1
    assert nodes[late.id].due_risk == GraphDueRisk.INSUFFICIENT_TIME
    assert nodes[overdue.id].due_risk == GraphDueRisk.OVERDUE
    assert response.summary.cancelled_prerequisite_count == 1
    assert response.summary.invalid_estimate_count == 1
    assert response.summary.critical_path_minutes is None
    assert cancelled_blocked.id in response.summary.unschedulable_task_ids


@pytest.mark.asyncio
async def test_container_used_as_dependency_keeps_critical_path_provisional(db_session):
    root = _todo("todo_root")
    container = _todo("todo_container", parent_id=root.id, estimated_minutes=120)
    child = _todo("todo_child", parent_id=container.id, estimated_minutes=30)
    gated = _todo("todo_gated", parent_id=root.id, estimated_minutes=20)
    db_session.add_all([root, container, child, gated])
    await db_session.flush()
    db_session.add(_dependency(gated.id, container.id))
    await db_session.commit()

    response = await get_graph_insights(db_session, root_task_id=root.id)
    nodes = _nodes_by_id(response)
    assert nodes[container.id].is_container is True
    assert nodes[container.id].estimated_minutes == 120
    assert nodes[container.id].estimate_complete is False
    assert response.summary.critical_path_minutes is None
    assert response.summary.critical_path_estimate_complete is False
    assert container.id in response.summary.unknown_estimate_task_ids


@pytest.mark.asyncio
async def test_unknown_only_project_path_points_to_actionable_leaf(db_session):
    root = _todo("todo_root", estimated_minutes=None)
    unknown_leaf = _todo(
        "todo_unknown_leaf",
        parent_id=root.id,
        estimated_minutes=None,
    )
    db_session.add_all([root, unknown_leaf])
    await db_session.commit()

    response = await get_graph_insights(db_session, root_task_id=root.id)
    assert response.summary.critical_path_task_ids == [unknown_leaf.id]
    assert response.summary.critical_path_known_minutes == 0
    assert response.summary.critical_path_minutes is None
    assert response.summary.critical_path_estimate_complete is False


@pytest.mark.asyncio
async def test_nested_container_deadline_fails_closed_to_unknown(db_session):
    now = datetime(2026, 8, 27, 12, 0, tzinfo=timezone.utc)
    root = _todo("todo_root", estimated_minutes=None)
    container = _todo(
        "todo_nested_container",
        parent_id=root.id,
        estimated_minutes=None,
        due_date=now + timedelta(minutes=30),
    )
    child = _todo(
        "todo_nested_child",
        parent_id=container.id,
        estimated_minutes=120,
    )
    db_session.add_all([root, container, child])
    await db_session.commit()

    response = await get_graph_insights(
        db_session,
        root_task_id=root.id,
        generated_at=now,
    )
    node = _nodes_by_id(response)[container.id]
    assert node.is_container is True
    assert node.estimate_complete is False
    assert node.remaining_path_minutes is None
    assert node.due_slack_minutes is None
    assert node.due_risk == GraphDueRisk.UNKNOWN_ESTIMATE


@pytest.mark.asyncio
async def test_cancelled_blocker_cuts_its_upstream_but_preserves_impact(db_session):
    root = _todo("todo_root")
    upstream = _todo("todo_upstream", parent_id=root.id)
    cancelled = _todo(
        "todo_cancelled",
        parent_id=root.id,
        status=TaskStatus.CANCELLED,
    )
    dependent = _todo("todo_dependent", parent_id=root.id)
    db_session.add_all([root, upstream, cancelled, dependent])
    await db_session.flush()
    db_session.add_all(
        [
            _dependency(cancelled.id, upstream.id),
            _dependency(dependent.id, cancelled.id),
        ]
    )
    await db_session.commit()

    response = await get_graph_insights(db_session, root_task_id=root.id)
    nodes = _nodes_by_id(response)
    assert nodes[dependent.id].direct_blocker_ids == [cancelled.id]
    assert nodes[dependent.id].transitive_blocker_ids == []
    assert nodes[cancelled.id].downstream_task_ids == [dependent.id]
    assert nodes[dependent.id].is_unschedulable is True
    assert response.summary.critical_path_minutes is None


@pytest.mark.asyncio
async def test_completed_dependency_cuts_irrelevant_unknown_context(db_session):
    root = _todo("todo_root")
    primary = _todo("todo_primary", parent_id=root.id, estimated_minutes=25)
    completed = _todo(
        "todo_completed_context",
        status=TaskStatus.COMPLETED,
        estimated_minutes=10,
    )
    external_unknown = _todo("todo_external_unknown", estimated_minutes=None)
    db_session.add_all([root, primary, completed, external_unknown])
    await db_session.flush()
    db_session.add_all(
        [
            _dependency(primary.id, completed.id),
            _dependency(completed.id, external_unknown.id),
        ]
    )
    await db_session.commit()

    response = await get_graph_insights(db_session, root_task_id=root.id)
    nodes = _nodes_by_id(response)
    assert nodes[external_unknown.id].scope_role == GraphScopeRole.CONTEXT
    assert response.summary.critical_path_task_ids == [primary.id]
    assert response.summary.critical_path_minutes == 25
    assert response.summary.critical_path_estimate_complete is True
    assert response.summary.unknown_estimate_task_ids == []


@pytest.mark.asyncio
async def test_project_root_due_risk_uses_child_critical_path(db_session):
    now = datetime(2026, 8, 27, 12, 0, tzinfo=timezone.utc)
    root = _todo(
        "todo_root",
        estimated_minutes=None,
        due_date=now + timedelta(minutes=60),
    )
    first = _todo("todo_first", parent_id=root.id, estimated_minutes=120)
    second = _todo(
        "todo_second",
        parent_id=root.id,
        estimated_minutes=120,
        due_date=now + timedelta(minutes=120),
    )
    db_session.add_all([root, first, second])
    await db_session.flush()
    db_session.add(_dependency(second.id, first.id))
    await db_session.commit()

    response = await get_graph_insights(
        db_session,
        root_task_id=root.id,
        generated_at=now,
    )
    root_node = _nodes_by_id(response)[root.id]
    assert response.summary.critical_path_minutes == 240
    assert root_node.remaining_path_minutes == 240
    assert root_node.due_slack_minutes == -180
    assert root_node.due_risk == GraphDueRisk.INSUFFICIENT_TIME
    assert response.summary.at_risk_count == 2
    assert response.summary.due_date_conflict_count == 1


def test_large_chain_caps_transitive_and_downstream_payloads():
    task_count = 250
    tasks = tuple(
        _TaskSnapshot(
            id=f"todo_{index:04d}",
            title=f"Task {index}",
            status=TaskStatus.PENDING,
            parent_id=None,
            estimated_minutes=1,
            due_date=None,
        )
        for index in range(task_count)
    )
    edges = tuple(
        _EdgeSnapshot(
            relationship_id=f"rel_{index:04d}",
            source_task_id=f"todo_{index:04d}",
            target_task_id=f"todo_{index - 1:04d}",
        )
        for index in range(1, task_count)
    )
    snapshot = _GraphSnapshot(
        revision=3,
        root_task_id=None,
        tasks=tasks,
        edges=edges,
        primary_ids=frozenset(task.id for task in tasks),
        container_ids=frozenset(),
        existing_parent_ids=frozenset(),
    )

    response = _analyze_snapshot(
        snapshot,
        generated_at=datetime(2026, 8, 27, tzinfo=timezone.utc),
    )
    nodes = _nodes_by_id(response)
    first = nodes["todo_0000"]
    last = nodes[f"todo_{task_count - 1:04d}"]
    assert len(first.downstream_task_ids) == 20
    assert first.downstream_truncated is True
    assert first.downstream_count == 21
    assert len(last.transitive_blocker_ids) == 20
    assert last.transitive_blockers_truncated is True
    assert last.transitive_blocker_count == 21
    assert response.summary.critical_path_minutes == task_count


def test_corrupt_cycles_and_dangling_dependencies_are_reported():
    tasks = (
        _TaskSnapshot(
            id="todo_first",
            title="First",
            status=TaskStatus.PENDING,
            parent_id=None,
            estimated_minutes=10,
            due_date=None,
        ),
        _TaskSnapshot(
            id="todo_second",
            title="Second",
            status=TaskStatus.PENDING,
            parent_id=None,
            estimated_minutes=10,
            due_date=None,
        ),
        _TaskSnapshot(
            id="todo_parent_left",
            title="Parent left",
            status=TaskStatus.PENDING,
            parent_id="todo_parent_right",
            estimated_minutes=10,
            due_date=None,
        ),
        _TaskSnapshot(
            id="todo_parent_right",
            title="Parent right",
            status=TaskStatus.PENDING,
            parent_id="todo_parent_left",
            estimated_minutes=10,
            due_date=None,
        ),
        _TaskSnapshot(
            id="todo_standalone",
            title="Standalone",
            status=TaskStatus.PENDING,
            parent_id=None,
            estimated_minutes=10,
            due_date=None,
        ),
    )
    snapshot = _GraphSnapshot(
        revision=11,
        root_task_id=None,
        tasks=tasks,
        edges=(
            _EdgeSnapshot("rel_first_second", "todo_first", "todo_second"),
            _EdgeSnapshot("rel_second_first", "todo_second", "todo_first"),
            _EdgeSnapshot("rel_dangling", "todo_first", "todo_missing"),
        ),
        primary_ids=frozenset(task.id for task in tasks),
        container_ids=frozenset({"todo_parent_left", "todo_parent_right"}),
        existing_parent_ids=frozenset(
            {"todo_parent_left", "todo_parent_right"}
        ),
    )
    response = _analyze_snapshot(
        snapshot,
        generated_at=datetime(2026, 8, 27, tzinfo=timezone.utc),
    )
    assert response.summary.cycle_count == 1
    assert response.summary.parent_cycle_count == 1
    assert response.summary.missing_dependency_count == 1
    assert response.summary.critical_path_minutes is None
    assert response.summary.is_healthy is False
    assert {issue.code.value for issue in response.issues}.issuperset(
        {"dependency_cycle", "parent_cycle", "missing_dependency"}
    )
    # Standalone roots are isolated execution nodes, not structural orphans.
    assert response.summary.orphan_count == 0
    assert response.summary.isolated_count == 1


def test_completed_node_cuts_health_cycle_from_execution_forecast():
    pending = _TaskSnapshot(
        id="todo_pending",
        title="Pending",
        status=TaskStatus.PENDING,
        parent_id=None,
        estimated_minutes=10,
        due_date=None,
    )
    completed = _TaskSnapshot(
        id="todo_completed",
        title="Completed",
        status=TaskStatus.COMPLETED,
        parent_id=None,
        estimated_minutes=10,
        due_date=None,
    )
    snapshot = _GraphSnapshot(
        revision=5,
        root_task_id=None,
        tasks=(pending, completed),
        edges=(
            _EdgeSnapshot("rel_pending_completed", pending.id, completed.id),
            _EdgeSnapshot("rel_completed_pending", completed.id, pending.id),
        ),
        primary_ids=frozenset({pending.id, completed.id}),
        container_ids=frozenset(),
        existing_parent_ids=frozenset(),
    )

    response = _analyze_snapshot(
        snapshot,
        generated_at=datetime(2026, 8, 27, tzinfo=timezone.utc),
    )
    nodes = _nodes_by_id(response)
    assert response.summary.cycle_count == 1
    assert any(issue.code.value == "dependency_cycle" for issue in response.issues)
    assert nodes[pending.id].is_ready is True
    assert nodes[pending.id].is_blocked is False
    assert nodes[pending.id].is_unschedulable is False
    assert nodes[pending.id].remaining_path_minutes == 10
    assert response.summary.unschedulable_count == 0
    assert response.summary.critical_path_task_ids == [pending.id]
    assert response.summary.critical_path_minutes == 10
    assert response.summary.critical_path_estimate_complete is True


def test_cancelled_node_in_health_cycle_remains_hard_blocker():
    pending = _TaskSnapshot(
        id="todo_pending",
        title="Pending",
        status=TaskStatus.PENDING,
        parent_id=None,
        estimated_minutes=10,
        due_date=None,
    )
    cancelled = _TaskSnapshot(
        id="todo_cancelled",
        title="Cancelled",
        status=TaskStatus.CANCELLED,
        parent_id=None,
        estimated_minutes=10,
        due_date=None,
    )
    snapshot = _GraphSnapshot(
        revision=6,
        root_task_id=None,
        tasks=(pending, cancelled),
        edges=(
            _EdgeSnapshot("rel_pending_cancelled", pending.id, cancelled.id),
            _EdgeSnapshot("rel_cancelled_pending", cancelled.id, pending.id),
        ),
        primary_ids=frozenset({pending.id, cancelled.id}),
        container_ids=frozenset(),
        existing_parent_ids=frozenset(),
    )

    response = _analyze_snapshot(
        snapshot,
        generated_at=datetime(2026, 8, 27, tzinfo=timezone.utc),
    )
    nodes = _nodes_by_id(response)
    assert response.summary.cycle_count == 1
    assert nodes[pending.id].is_ready is False
    assert nodes[pending.id].is_blocked is True
    assert nodes[pending.id].is_unschedulable is True
    assert nodes[pending.id].remaining_path_minutes is None
    assert nodes[cancelled.id].downstream_task_ids == [pending.id]
    assert response.summary.unschedulable_task_ids == [pending.id]
    assert response.summary.critical_path_minutes is None
    assert response.summary.critical_path_estimate_complete is False


@pytest.mark.asyncio
async def test_graph_insight_http_contract_and_root_validation(
    client,
    auth_headers,
    db_session,
):
    root = _todo("todo_root")
    child = _todo("todo_child", parent_id=root.id)
    db_session.add_all([root, child])
    await db_session.commit()

    response = await client.get(
        "/api/todos/graph/insights",
        params={"root_task_id": root.id},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["scope"]["root_task_id"] == root.id
    assert payload["nodes"][0]["scope_role"] in {"root", "descendant"}

    nested = await client.get(
        "/api/todos/graph/insights",
        params={"root_task_id": child.id},
        headers=auth_headers,
    )
    assert nested.status_code == 400
    assert nested.json()["error"]["code"] == "VALIDATION_ERROR"

    missing = await client.get(
        "/api/todos/graph/insights",
        params={"root_task_id": "todo_missing"},
        headers=auth_headers,
    )
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "NOT_FOUND"

    openapi = (await client.get("/openapi.json")).json()
    operation = openapi["paths"]["/api/todos/graph/insights"]["get"]
    response_schema = operation["responses"]["200"]["content"][
        "application/json"
    ]["schema"]
    assert response_schema["$ref"].endswith("/GraphInsightsResponse")


@pytest.mark.asyncio
async def test_scoped_snapshot_uses_constant_query_count(db_session):
    root = _todo("todo_root")
    children = [
        _todo(f"todo_child_{index:02d}", parent_id=root.id)
        for index in range(30)
    ]
    db_session.add_all([root, *children])
    await db_session.commit()

    statements: list[str] = []

    def record_statement(_conn, _cursor, statement, _params, _context, _many):
        statements.append(statement)

    engine = db_session.bind.sync_engine
    event.listen(engine, "before_cursor_execute", record_statement)
    try:
        response = await get_graph_insights(db_session, root_task_id=root.id)
    finally:
        event.remove(engine, "before_cursor_execute", record_statement)

    assert response.scope.primary_task_count == 31
    assert len(statements) <= 8
