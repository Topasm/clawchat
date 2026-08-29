"""Durable agent execution attempts, review, retry, and cancellation."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from database import _backfill_agent_runs
from domain.review import ReviewSubjectType
from main import app
from models.agent_run import AgentRun, AgentRunEvent
from models.agent_task import AgentTask
from models.project import Project
from models.review_item import ReviewItem
from models.todo import Todo
from services.agents import agent_run_service, agent_task_service
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


class FakeAI:
    model = "fake-model"

    async def generate_completion(self, *, system_prompt, user_message):
        return f"Result for {user_message}"


async def create_project_task(db_session):
    project = Project(id="project_runs", title="Run project")
    db_session.add(project)
    await db_session.flush()
    todo = Todo(id="todo_runs", project_id=project.id, title="Execute work")
    db_session.add(todo)
    await db_session.flush()
    task = AgentTask(
        id="task_runs",
        task_type="research",
        instruction="Research the execution model",
        todo_id=todo.id,
        agent_type="research",
    )
    db_session.add(task)
    await db_session.flush()
    project.root_task_id = todo.id
    await db_session.commit()
    return project, todo, task


@pytest.mark.asyncio
async def test_execution_creates_reviewable_run_and_approval_adopts_it(
    client, auth_headers, db_session
):
    project, _todo, task = await create_project_task(db_session)
    run = await agent_run_service.create_run(
        db_session, task, provider="openclaw", model="fake-model"
    )
    await db_session.commit()
    ws = SimpleNamespace(send_json=AsyncMock())

    await agent_task_service.execute_task(
        db_session,
        task,
        FakeAI(),
        ws,
        "user",
        run=run,
        provider="openclaw",
    )

    await db_session.refresh(run)
    assert run.status == "waiting_review"
    assert run.result == "Result for Research the execution model"
    assert run.project_id == project.id
    events = list((await db_session.execute(select(AgentRunEvent).where(
        AgentRunEvent.run_id == run.id
    ).order_by(AgentRunEvent.sequence))).scalars().all())
    assert [event.event_type for event in events] == [
        "queued", "starting", "running", "progress", "progress", "waiting_review"
    ]
    review = (await db_session.execute(select(ReviewItem).where(
        ReviewItem.subject_type == ReviewSubjectType.AGENT_RUN,
        ReviewItem.subject_id == run.id,
    ))).scalar_one()
    assert review.status == "pending"

    response = await client.post(
        f"/api/reviews/{review.id}/decision",
        headers=auth_headers,
        json={"decision": "approved", "note": "Use this result"},
    )
    assert response.status_code == 200, response.text
    await db_session.refresh(run)
    assert run.status == "completed"
    assert run.is_adopted is True
    todo = await db_session.get(Todo, task.todo_id)
    await db_session.refresh(todo)
    assert todo.status == "completed"


@pytest.mark.asyncio
async def test_new_attempt_preserves_previous_result(db_session):
    _project, _todo, task = await create_project_task(db_session)
    first = await agent_run_service.create_run(
        db_session, task, provider="openclaw", model="model-a"
    )
    await agent_run_service.mark_starting(db_session, first)
    await agent_run_service.mark_running(db_session, first)
    first.result = "Partial result"
    await agent_run_service.mark_failed(db_session, first, "Timeout")
    await db_session.commit()

    second = await agent_run_service.create_run(
        db_session,
        task,
        provider="openclaw",
        model="model-b",
        instruction_snapshot="Try with a smaller scope",
    )
    await db_session.commit()

    assert second.attempt == 2
    assert second.instruction_snapshot == "Try with a smaller scope"
    await db_session.refresh(first)
    assert first.result == "Partial result"
    assert first.error == "Timeout"


@pytest.mark.asyncio
async def test_cancel_endpoint_stops_registered_execution(
    client, auth_headers, db_session
):
    _project, _todo, task = await create_project_task(db_session)
    run = await agent_run_service.create_run(db_session, task, provider="openclaw")
    await agent_run_service.mark_starting(db_session, run)
    await agent_run_service.mark_running(db_session, run)
    await db_session.commit()
    cancelled = asyncio.Event()

    async def worker():
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    agent_run_service.launch_execution(run.id, worker())
    response = await client.post(
        f"/api/runs/{run.id}/cancel", headers=auth_headers
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "cancelled"
    await asyncio.wait_for(cancelled.wait(), timeout=1)
    await db_session.refresh(run)
    assert run.status == "cancelled"
    assert run.cancel_requested_at is not None


@pytest.mark.asyncio
async def test_legacy_agent_run_backfill_is_idempotent(db_session):
    task = AgentTask(
        id="task_legacy_run",
        task_type="research",
        instruction="Old execution",
        status="completed",
        result="Historical result",
        progress=100,
    )
    db_session.add(task)
    await db_session.commit()

    await _backfill_agent_runs(db_session)
    await _backfill_agent_runs(db_session)
    await db_session.commit()

    runs = list((await db_session.execute(select(AgentRun).where(
        AgentRun.agent_task_id == task.id
    ))).scalars().all())
    assert len(runs) == 1
    assert runs[0].provider == "legacy"
    assert runs[0].is_adopted is True
    assert runs[0].result == "Historical result"


@pytest.mark.asyncio
async def test_retry_endpoint_creates_and_executes_next_attempt(
    client, auth_headers, db_session
):
    _project, _todo, task = await create_project_task(db_session)
    first = await agent_run_service.create_run(
        db_session, task, provider="openclaw", model="old-model"
    )
    await agent_run_service.mark_starting(db_session, first)
    await agent_run_service.mark_running(db_session, first)
    await agent_run_service.mark_failed(db_session, first, "Provider timeout")
    await db_session.commit()
    state_names = ("active_ai", "active_ai_provider", "session_factory")
    previous = {
        name: getattr(app.state, name) for name in state_names if hasattr(app.state, name)
    }
    try:
        app.state.active_ai = FakeAI()
        app.state.active_ai_provider = "openclaw"
        app.state.session_factory = async_sessionmaker(
            db_session.bind, class_=AsyncSession, expire_on_commit=False
        )

        response = await client.post(
            f"/api/runs/{first.id}/retry",
            headers=auth_headers,
            json={"follow_up_instruction": "Use a narrower query"},
        )
        assert response.status_code == 201, response.text
        assert response.json()["attempt"] == 2
        assert "Use a narrower query" in response.json()["instruction_snapshot"]
        second_id = response.json()["id"]
        for _ in range(50):
            await asyncio.sleep(0.01)
            db_session.expire_all()
            second = await db_session.get(AgentRun, second_id)
            if second and second.status == "waiting_review":
                break
        else:
            pytest.fail("retried run did not reach review")
        assert second.result is not None
    finally:
        for name in state_names:
            if name in previous:
                setattr(app.state, name, previous[name])
            elif hasattr(app.state, name):
                delattr(app.state, name)
