"""Explicit recovery of unsuccessful Agent runs back to the task graph."""

import pytest

from domain.review import ReviewStatus
from domain.task_relationship import TaskRelationshipType
from models.agent_run import AgentRunEvent
from models.agent_task import AgentTask
from models.project import Project
from models.review_item import ReviewItem
from models.task_relationship import TaskRelationship
from models.todo import Todo
from services import agent_run_service
from sqlalchemy import select


async def _create_project_run(db_session):
    project = Project(id="project_recovery", title="Recovery project")
    db_session.add(project)
    await db_session.flush()
    todo = Todo(id="todo_recovery", project_id=project.id, title="Recover work")
    db_session.add(todo)
    await db_session.flush()
    project.root_task_id = todo.id
    task = AgentTask(
        id="agent_task_recovery",
        task_type="execute",
        instruction="Execute recoverable work",
        todo_id=todo.id,
        agent_type="executor",
    )
    db_session.add(task)
    await db_session.commit()
    run = await agent_run_service.create_run(
        db_session,
        task,
        provider="openclaw",
        model="test-model",
    )
    await agent_run_service.mark_starting(db_session, run)
    await agent_run_service.mark_running(db_session, run)
    return project, todo, task, run


@pytest.mark.asyncio
async def test_failed_run_returns_task_to_pending_once(
    client, auth_headers, db_session
):
    _project, todo, task, run = await _create_project_run(db_session)
    task.status = "failed"
    task.error = "Provider failed"
    await agent_run_service.mark_failed(db_session, run, "Provider failed")
    await db_session.commit()

    response = await client.post(
        f"/api/runs/{run.id}/return-to-ready",
        headers=auth_headers,
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["run_id"] == run.id
    assert payload["todo_id"] == todo.id
    assert payload["todo_status"] == "pending"
    assert payload["graph_revision"] >= 1
    await db_session.refresh(todo)
    assert todo.status == "pending"
    event_types = list(
        (
            await db_session.execute(
                select(AgentRunEvent.event_type)
                .where(AgentRunEvent.run_id == run.id)
                .order_by(AgentRunEvent.sequence)
            )
        ).scalars()
    )
    assert event_types[-1] == "returned_to_ready"

    duplicate = await client.post(
        f"/api/runs/{run.id}/return-to-ready",
        headers=auth_headers,
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "TASK_EXECUTION_STATE_CONFLICT"
    retry_after_return = await client.post(
        f"/api/runs/{run.id}/retry",
        headers=auth_headers,
        json={},
    )
    assert retry_after_return.status_code == 409
    assert retry_after_return.json()["error"]["code"] == "TASK_EXECUTION_STATE_CONFLICT"


@pytest.mark.asyncio
async def test_rejected_review_can_explicitly_return_task_to_queue(
    client, auth_headers, db_session
):
    _project, todo, task, run = await _create_project_run(db_session)
    await agent_run_service.mark_waiting_review(db_session, run, task, "Unacceptable result")
    await db_session.commit()
    review = (
        await db_session.execute(
            select(ReviewItem).where(
                ReviewItem.subject_type == "agent_run",
                ReviewItem.subject_id == run.id,
            )
        )
    ).scalar_one()
    await db_session.commit()

    rejected = await client.post(
        f"/api/reviews/{review.id}/decision",
        headers=auth_headers,
        json={"decision": "rejected", "note": "Try another approach"},
    )
    recovered = await client.post(
        f"/api/runs/{run.id}/return-to-ready",
        headers=auth_headers,
    )

    assert rejected.status_code == 200, rejected.text
    assert recovered.status_code == 200, recovered.text
    await db_session.refresh(todo)
    assert todo.status == "pending"


@pytest.mark.asyncio
async def test_recovery_reports_blocked_when_dependencies_changed(
    client, auth_headers, db_session
):
    project, todo, task, run = await _create_project_run(db_session)
    task.status = "failed"
    await agent_run_service.mark_failed(db_session, run, "Provider failed")
    prerequisite = Todo(
        id="todo_recovery_prerequisite",
        project_id=project.id,
        title="New prerequisite",
    )
    db_session.add(prerequisite)
    await db_session.flush()
    db_session.add(
        TaskRelationship(
            id="rel_recovery_prerequisite",
            source_task_id=todo.id,
            target_task_id=prerequisite.id,
            type=TaskRelationshipType.DEPENDS_ON,
        )
    )
    await db_session.commit()

    response = await client.post(
        f"/api/runs/{run.id}/return-to-ready",
        headers=auth_headers,
    )

    assert response.status_code == 200, response.text
    assert response.json()["is_ready"] is False
    assert response.json()["execution_state"] == "blocked"
    assert response.json()["direct_blocker_ids"] == [prerequisite.id]


@pytest.mark.asyncio
async def test_superseded_run_cannot_recover_task(
    client, auth_headers, db_session
):
    _project, _todo, task, first = await _create_project_run(db_session)
    task.status = "failed"
    await agent_run_service.mark_failed(db_session, first, "First failure")
    await db_session.commit()
    second = await agent_run_service.create_run(
        db_session,
        task,
        provider="openclaw",
        model="test-model",
    )
    task.status = "failed"
    await agent_run_service.mark_failed(db_session, second, "Second failure")
    await db_session.commit()

    response = await client.post(
        f"/api/runs/{first.id}/return-to-ready",
        headers=auth_headers,
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "AGENT_RUN_SUPERSEDED"


@pytest.mark.asyncio
async def test_adopted_run_cannot_be_retried_or_returned_to_ready(
    client, auth_headers, db_session
):
    _project, todo, task, run = await _create_project_run(db_session)
    await agent_run_service.mark_waiting_review(db_session, run, task, "Accepted result")
    await agent_run_service.decide_run(db_session, run.id, ReviewStatus.APPROVED)
    await db_session.commit()

    recovery = await client.post(
        f"/api/runs/{run.id}/return-to-ready",
        headers=auth_headers,
    )
    retry = await client.post(
        f"/api/runs/{run.id}/retry",
        headers=auth_headers,
        json={},
    )

    assert recovery.status_code == 409
    assert recovery.json()["error"]["code"] == "AGENT_RUN_NOT_RETRYABLE"
    assert retry.status_code == 409
    assert retry.json()["error"]["code"] == "AGENT_RUN_NOT_RETRYABLE"
    await db_session.refresh(todo)
    assert todo.status == "completed"
