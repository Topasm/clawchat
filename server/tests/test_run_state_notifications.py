"""Run lifecycle transitions reach the user, and a review note resumes a run."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from domain.review import ReviewSubjectType
from main import app
from models.agent_run import AgentRun, AgentRunEvent
from models.agent_task import AgentTask
from models.project import Project
from models.review_item import ReviewItem
from models.todo import Todo
from services.agents import agent_run_service, agent_task_service


class FakeAI:
    model = "fake-model"

    async def generate_completion(self, *, system_prompt, user_message):
        return f"Result for {user_message}"


async def create_project_task(db_session):
    project = Project(id="project_notify", title="Notify project")
    db_session.add(project)
    await db_session.flush()
    todo = Todo(id="todo_notify", project_id=project.id, title="Draft the brief")
    db_session.add(todo)
    await db_session.flush()
    task = AgentTask(
        id="task_notify",
        task_type="research",
        instruction="Research the brief",
        todo_id=todo.id,
        agent_type="research",
        conversation_id=None,
    )
    db_session.add(task)
    await db_session.flush()
    project.root_task_id = todo.id
    await db_session.commit()
    return project, todo, task


@pytest.fixture
def run_state_events(monkeypatch):
    """Capture every ``run_state_changed`` push, in order."""
    fake = SimpleNamespace(send_json=AsyncMock())
    monkeypatch.setattr(agent_run_service, "ws_manager", fake)

    def collected():
        return [
            call.args[1]["data"]
            for call in fake.send_json.await_args_list
            if call.args[1]["type"] == "run_state_changed"
        ]

    return collected


async def execute_to_review(db_session, task, run):
    ws = SimpleNamespace(send_json=AsyncMock())
    await agent_task_service.execute_task(
        db_session, task, FakeAI(), ws, "user", run=run, provider="openclaw"
    )
    await db_session.refresh(run)
    assert run.status == "waiting_review"
    return ws


@pytest.mark.asyncio
async def test_every_transition_pushes_run_state(db_session, run_state_events):
    _project, todo, task = await create_project_task(db_session)
    run = await agent_run_service.create_run(db_session, task, provider="openclaw")
    await db_session.commit()

    await execute_to_review(db_session, task, run)

    events = run_state_events()
    assert [event["status"] for event in events] == ["starting", "running", "waiting_review"]
    final = events[-1]
    review = (await db_session.execute(select(ReviewItem).where(
        ReviewItem.subject_type == ReviewSubjectType.AGENT_RUN,
        ReviewItem.subject_id == run.id,
    ))).scalar_one()
    assert final["run_id"] == run.id
    assert final["agent_task_id"] == task.id
    assert final["todo_id"] == todo.id
    assert final["title"] == "Draft the brief"
    assert final["review_id"] == review.id
    assert final["result_summary"] == "Result for Research the brief"
    assert final["is_adopted"] is False


@pytest.mark.asyncio
async def test_task_completed_carries_the_run_status(db_session, run_state_events):
    """The chat card must not call a result done while it still awaits review."""
    _project, _todo, task = await create_project_task(db_session)
    run = await agent_run_service.create_run(db_session, task, provider="openclaw")
    await db_session.commit()

    ws = await execute_to_review(db_session, task, run)

    completed = next(
        call.args[1]["data"]
        for call in ws.send_json.await_args_list
        if call.args[1]["type"] == "task_completed"
    )
    assert completed["run_id"] == run.id
    assert completed["run_status"] == "waiting_review"


@pytest.mark.asyncio
async def test_failure_and_cancellation_push_run_state(db_session, run_state_events):
    _project, _todo, task = await create_project_task(db_session)
    run = await agent_run_service.create_run(db_session, task, provider="openclaw")
    await agent_run_service.mark_starting(db_session, run)
    await agent_run_service.mark_running(db_session, run)
    await agent_run_service.mark_failed(db_session, run, "Provider timeout")
    await db_session.commit()

    second = await agent_run_service.create_run(db_session, task, provider="openclaw")
    await agent_run_service.mark_starting(db_session, second)
    await db_session.commit()
    await agent_run_service.cancel_run(db_session, second.id)

    statuses = [(event["run_id"], event["status"]) for event in run_state_events()]
    assert (run.id, "failed") in statuses
    assert (second.id, "cancelled") in statuses
    failed = next(event for event in run_state_events() if event["status"] == "failed")
    assert failed["error"] == "Provider timeout"


def _swap_app_state(db_session):
    state_names = ("active_ai", "active_ai_provider", "session_factory")
    previous = {
        name: getattr(app.state, name) for name in state_names if hasattr(app.state, name)
    }
    app.state.active_ai = FakeAI()
    app.state.active_ai_provider = "openclaw"
    app.state.session_factory = async_sessionmaker(
        db_session.bind, class_=AsyncSession, expire_on_commit=False
    )

    def restore():
        for name in state_names:
            if name in previous:
                setattr(app.state, name, previous[name])
            elif hasattr(app.state, name):
                delattr(app.state, name)

    return restore


async def review_item_for(db_session, run_id):
    return (await db_session.execute(select(ReviewItem).where(
        ReviewItem.subject_type == ReviewSubjectType.AGENT_RUN,
        ReviewItem.subject_id == run_id,
    ))).scalar_one()


@pytest.mark.asyncio
async def test_changes_requested_note_resumes_the_run(
    client, auth_headers, db_session, run_state_events
):
    _project, _todo, task = await create_project_task(db_session)
    run = await agent_run_service.create_run(db_session, task, provider="openclaw")
    await db_session.commit()
    await execute_to_review(db_session, task, run)
    run_id = run.id
    review = await review_item_for(db_session, run_id)
    restore = _swap_app_state(db_session)
    try:
        response = await client.post(
            f"/api/reviews/{review.id}/decision",
            headers=auth_headers,
            json={"decision": "changes_requested", "note": "Tighten the scope"},
        )
        assert response.status_code == 200, response.text
        assert response.json()["outcome"]["auto_resumed"] is True

        pushed = []
        for _ in range(100):
            await asyncio.sleep(0.01)
            db_session.expire_all()
            resumed = await db_session.get(AgentRun, run_id)
            pushed = [
                event["status"]
                for event in run_state_events()
                if event["run_id"] == run_id
            ]
            if (
                resumed
                and resumed.status == "waiting_review"
                and pushed
                and pushed[-1] == "waiting_review"
            ):
                break
        else:
            pytest.fail(
                "run and its notification did not come back for review after the note"
            )

        assert "Follow-up instruction:\nTighten the scope" in resumed.instruction_snapshot
        assert resumed.attempt == 1
        assert "Tighten the scope" in (resumed.result or "")
        event_types = [
            event.event_type
            for event in (await db_session.execute(
                select(AgentRunEvent).where(AgentRunEvent.run_id == run_id)
                .order_by(AgentRunEvent.sequence)
            )).scalars().all()
        ]
        assert "changes_requested" in event_types
        assert event_types.index("resuming") > event_types.index("changes_requested")
        # A fresh review round opened for the resumed attempt.
        review = await review_item_for(db_session, run_id)
        assert review.status == "pending"
        assert "waiting_input" in pushed
        assert pushed[-1] == "waiting_review"
    finally:
        restore()


@pytest.mark.asyncio
async def test_changes_requested_without_note_waits_for_input(
    client, auth_headers, db_session, run_state_events
):
    _project, _todo, task = await create_project_task(db_session)
    run = await agent_run_service.create_run(db_session, task, provider="openclaw")
    await db_session.commit()
    await execute_to_review(db_session, task, run)
    review = await review_item_for(db_session, run.id)

    response = await client.post(
        f"/api/reviews/{review.id}/decision",
        headers=auth_headers,
        json={"decision": "changes_requested"},
    )
    assert response.status_code == 200, response.text
    assert "auto_resumed" not in response.json()["outcome"]
    await db_session.refresh(run)
    assert run.status == "waiting_input"
    assert run_state_events()[-1]["status"] == "waiting_input"


@pytest.mark.asyncio
async def test_changes_requested_note_stays_waiting_when_provider_is_gone(
    client, auth_headers, db_session, run_state_events
):
    """A note that cannot resume now must not lose the decision or the note."""
    _project, _todo, task = await create_project_task(db_session)
    run = await agent_run_service.create_run(db_session, task, provider="openclaw")
    await db_session.commit()
    await execute_to_review(db_session, task, run)
    run_id = run.id
    review = await review_item_for(db_session, run_id)
    restore = _swap_app_state(db_session)
    try:
        app.state.active_ai_provider = "codex"
        response = await client.post(
            f"/api/reviews/{review.id}/decision",
            headers=auth_headers,
            json={"decision": "changes_requested", "note": "Tighten the scope"},
        )
        assert response.status_code == 200, response.text
        assert response.json()["outcome"]["auto_resumed"] is False
        # The decision landed through another session; drop cached rows.
        db_session.expire_all()
        await db_session.refresh(run)
        assert run.status == "waiting_input"
        assert "Follow-up instruction" not in run.instruction_snapshot
        review = await review_item_for(db_session, run_id)
        assert review.status == "changes_requested"
        assert review.review_note == "Tighten the scope"
    finally:
        restore()
