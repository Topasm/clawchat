"""Agent Run approval preview and downstream Ready handoff coverage."""

import asyncio

import pytest

from database import Base
from domain.agent_run import AgentRunStatus
from domain.review import ReviewStatus, ReviewSubjectType
from domain.task import TaskStatus
from domain.task_relationship import TaskRelationshipType
from exceptions import ConflictError
from models.agent_run import AgentRun, AgentRunEvent
from models.agent_task import AgentTask
from models.project import Project
from models.review_item import ReviewItem
from models.task_relationship import TaskRelationship
from models.todo import Todo
from services import agent_run_service, graph_insights_service
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine


async def _create_review_handoff_graph(db_session):
    project = Project(id="project_review_handoff", title="Review handoff")
    db_session.add(project)
    await db_session.flush()

    root = Todo(
        id="todo_review_root",
        project_id=project.id,
        title="Review handoff",
        source="project_root",
    )
    db_session.add(root)
    await db_session.flush()
    project.root_task_id = root.id

    reviewed = Todo(
        id="todo_reviewed_work",
        project_id=project.id,
        parent_id=root.id,
        title="Reviewed work",
    )
    released = Todo(
        id="todo_released_work",
        project_id=project.id,
        parent_id=root.id,
        title="Released work",
    )
    other_blocker = Todo(
        id="todo_other_blocker",
        project_id=project.id,
        parent_id=root.id,
        title="Other blocker",
    )
    still_blocked = Todo(
        id="todo_still_blocked",
        project_id=project.id,
        parent_id=root.id,
        title="Still blocked",
    )
    unrelated_ready = Todo(
        id="todo_unrelated_ready",
        project_id=project.id,
        parent_id=root.id,
        title="Already ready",
    )
    db_session.add_all(
        [reviewed, released, other_blocker, still_blocked, unrelated_ready]
    )
    await db_session.flush()
    db_session.add_all(
        [
            TaskRelationship(
                id="rel_released_reviewed",
                source_task_id=released.id,
                target_task_id=reviewed.id,
                type=TaskRelationshipType.DEPENDS_ON,
            ),
            TaskRelationship(
                id="rel_still_reviewed",
                source_task_id=still_blocked.id,
                target_task_id=reviewed.id,
                type=TaskRelationshipType.DEPENDS_ON,
            ),
            TaskRelationship(
                id="rel_still_other",
                source_task_id=still_blocked.id,
                target_task_id=other_blocker.id,
                type=TaskRelationshipType.DEPENDS_ON,
            ),
        ]
    )
    task = AgentTask(
        id="task_review_handoff",
        task_type="research",
        instruction="Complete reviewed work",
        todo_id=reviewed.id,
        agent_type="research",
    )
    db_session.add(task)
    await db_session.commit()

    run = await agent_run_service.create_run(
        db_session,
        task,
        provider="openclaw",
        model="fake-model",
    )
    await db_session.commit()
    await agent_run_service.mark_starting(db_session, run)
    await db_session.commit()
    await agent_run_service.mark_running(db_session, run)
    await db_session.commit()
    await agent_run_service.mark_waiting_review(
        db_session,
        run,
        task,
        "Reviewed result",
    )
    await db_session.commit()

    review = (
        await db_session.execute(
            select(ReviewItem).where(
                ReviewItem.subject_type == ReviewSubjectType.AGENT_RUN,
                ReviewItem.subject_id == run.id,
            )
        )
    ).scalar_one()
    return project, reviewed, released, still_blocked, run, review


@pytest.mark.asyncio
async def test_agent_review_preview_is_read_only_and_identifies_exact_unlocks(
    client,
    auth_headers,
    db_session,
):
    project, reviewed, released, _still_blocked, run, review = (
        await _create_review_handoff_graph(db_session)
    )
    await db_session.refresh(project)
    preview_revision = project.graph_revision
    await db_session.commit()

    response = await client.get("/api/reviews", headers=auth_headers)

    assert response.status_code == 200, response.text
    payload = next(item for item in response.json() if item["id"] == review.id)
    assert payload["subject_id"] == run.id
    assert payload["metadata"]["approval_impact"] == {
        "todo_id": reviewed.id,
        "graph_revision": preview_revision,
        "newly_ready_tasks": [{"id": released.id, "title": released.title}],
    }

    await db_session.refresh(reviewed)
    await db_session.refresh(released)
    await db_session.refresh(project)
    assert reviewed.status == TaskStatus.IN_PROGRESS
    assert released.status == TaskStatus.PENDING
    assert project.graph_revision == preview_revision


@pytest.mark.asyncio
async def test_agent_approval_returns_typed_handoff_and_releases_ready_task_once(
    client,
    auth_headers,
    db_session,
):
    project, reviewed, released, still_blocked, run, review = (
        await _create_review_handoff_graph(db_session)
    )
    await db_session.refresh(project)
    before_revision = project.graph_revision
    await db_session.commit()

    approved = await client.post(
        f"/api/reviews/{review.id}/decision",
        headers=auth_headers,
        json={"decision": "approved", "note": "Adopt and continue"},
    )

    assert approved.status_code == 200, approved.text
    payload = approved.json()
    assert payload["review"]["status"] == "approved"
    assert payload["outcome"] == {
        "run_id": run.id,
        "agent_task_id": run.agent_task_id,
        "todo_id": reviewed.id,
        "todo_status": "completed",
        "graph_revision": payload["outcome"]["graph_revision"],
        "newly_ready_tasks": [{"id": released.id, "title": released.title}],
        "adopted": True,
        "attempt": 1,
    }
    assert payload["outcome"]["graph_revision"] > before_revision

    insights = await graph_insights_service.get_graph_insights(
        db_session,
        root_task_id=project.root_task_id,
    )
    nodes = {node.task_id: node for node in insights.nodes}
    assert nodes[released.id].is_ready is True
    assert nodes[still_blocked.id].is_ready is False
    assert nodes[still_blocked.id].direct_blocker_ids == ["todo_other_blocker"]
    await db_session.commit()

    duplicate = await client.post(
        f"/api/reviews/{review.id}/decision",
        headers=auth_headers,
        json={"decision": "rejected"},
    )

    assert duplicate.status_code == 409, duplicate.text
    approved_event_count = (
        await db_session.execute(
            select(func.count(AgentRunEvent.id)).where(
                AgentRunEvent.run_id == run.id,
                AgentRunEvent.event_type == "approved",
            )
        )
    ).scalar_one()
    await db_session.refresh(project)
    persisted_run = await db_session.get(type(run), run.id)
    await db_session.refresh(persisted_run)
    assert approved_event_count == 1
    assert project.graph_revision == payload["outcome"]["graph_revision"]
    assert persisted_run.status == AgentRunStatus.COMPLETED
    assert persisted_run.is_adopted is True


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("left_decision", "right_decision"),
    [
        (ReviewStatus.APPROVED, ReviewStatus.REJECTED),
        (ReviewStatus.CHANGES_REQUESTED, ReviewStatus.REJECTED),
    ],
)
async def test_concurrent_review_decisions_have_one_cas_winner(
    tmp_path,
    left_decision,
    right_decision,
):
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'agent-review-race.db'}",
    )
    session_factory = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    try:
        async with session_factory() as db:
            todo = Todo(id="todo_review_race", title="Race review")
            task = AgentTask(
                id="task_review_race",
                task_type="research",
                instruction="Race review",
                status="completed",
                todo_id=todo.id,
            )
            run = AgentRun(
                id="run_review_race",
                agent_task_id=task.id,
                attempt=1,
                instruction_snapshot=task.instruction,
                provider="openclaw",
                status=AgentRunStatus.WAITING_REVIEW,
                result="Race result",
            )
            db.add(todo)
            await db.flush()
            db.add(task)
            await db.flush()
            db.add(run)
            await db.commit()

        barrier = asyncio.Barrier(2)

        async def decide(decision):
            async with session_factory() as db:
                try:
                    await agent_run_service.require_run(db, run.id)
                    await barrier.wait()
                    await agent_run_service.decide_run(db, run.id, decision)
                    await db.commit()
                    return decision.value
                except ConflictError:
                    await db.rollback()
                    return "conflict"

        results = await asyncio.gather(
            decide(left_decision),
            decide(right_decision),
        )

        assert results.count("conflict") == 1
        assert len(set(results) - {"conflict"}) == 1
        async with session_factory() as db:
            persisted_run = await db.get(AgentRun, run.id)
            events = list(
                (
                    await db.execute(
                        select(AgentRunEvent).where(
                            AgentRunEvent.run_id == run.id,
                            AgentRunEvent.event_type.in_(
                                ("approved", "changes_requested", "rejected")
                            ),
                        )
                    )
                )
                .scalars()
                .all()
            )
            assert persisted_run is not None
            winning_decision = next(result for result in results if result != "conflict")
            expected_status = (
                AgentRunStatus.WAITING_INPUT
                if winning_decision == ReviewStatus.CHANGES_REQUESTED
                else AgentRunStatus.COMPLETED
            )
            assert persisted_run.status == expected_status
            assert len(events) == 1
            assert events[0].event_type in set(results)
    finally:
        await engine.dispose()
