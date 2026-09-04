"""Every run has a conversation, and its decision points land there as messages."""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from domain.review import ReviewStatus
from models.agent_task import AgentTask
from models.conversation import Conversation
from models.message import Message
from models.project import Project
from models.todo import Todo
from services.agents import agent_run_service, agent_task_service, run_thread_service
from ws import notifications as ws_notifications


class FakeAI:
    model = "fake-model"

    async def generate_completion(self, *, system_prompt, user_message):
        return f"Result for {user_message}"


async def create_project_task(db_session, *, conversation_id=None):
    project = Project(id="project_thread", title="Thread project")
    db_session.add(project)
    await db_session.flush()
    todo = Todo(id="todo_thread", project_id=project.id, title="Write the launch note")
    db_session.add(todo)
    await db_session.flush()
    task = AgentTask(
        id="task_thread",
        task_type="draft",
        instruction="Draft the launch note",
        todo_id=todo.id,
        agent_type="draft",
        conversation_id=conversation_id,
    )
    db_session.add(task)
    await db_session.flush()
    project.root_task_id = todo.id
    await db_session.commit()
    return project, todo, task


async def thread_messages(db_session, conversation_id):
    rows = list(
        (
            await db_session.execute(
                select(Message)
                .where(Message.conversation_id == conversation_id)
                .order_by(Message.created_at.asc(), Message.id.asc())
            )
        ).scalars().all()
    )
    return [(row, json.loads(row.metadata_json) if row.metadata_json else {}) for row in rows]


@pytest.fixture
def silence_ws(monkeypatch):
    monkeypatch.setattr(agent_run_service, "ws_manager", SimpleNamespace(send_json=AsyncMock()))


@pytest.mark.asyncio
async def test_inbox_started_run_gets_a_project_scoped_thread(db_session, silence_ws):
    project, todo, task = await create_project_task(db_session)
    run = await agent_run_service.create_run(db_session, task, provider="openclaw")
    await db_session.commit()

    assert task.conversation_id is not None
    conversation = await db_session.get(Conversation, task.conversation_id)
    assert conversation.title == "Write the launch note"
    assert conversation.project_id == project.id
    assert conversation.project_todo_id == todo.id
    assert json.loads(conversation.metadata_json)["origin"] == "agent_run"
    response = await agent_run_service.build_run_response(db_session, run)
    assert response.conversation_id == conversation.id


@pytest.mark.asyncio
async def test_chat_delegated_run_keeps_its_conversation(db_session, silence_ws):
    existing = Conversation(id="conv_existing", title="Planning chat")
    db_session.add(existing)
    await db_session.commit()
    _project, _todo, task = await create_project_task(db_session, conversation_id=existing.id)

    await agent_run_service.create_run(db_session, task, provider="openclaw")
    await db_session.commit()

    assert task.conversation_id == existing.id
    count = (await db_session.execute(select(Conversation))).scalars().all()
    assert len(count) == 1


@pytest.mark.asyncio
async def test_run_lifecycle_is_written_into_the_thread_once(db_session, silence_ws):
    _project, _todo, task = await create_project_task(db_session)
    run = await agent_run_service.create_run(db_session, task, provider="openclaw")
    await db_session.commit()
    ws = SimpleNamespace(send_json=AsyncMock())

    await agent_task_service.execute_task(
        db_session, task, FakeAI(), ws, "user", run=run, provider="openclaw"
    )
    # A repeated notification for the same transition must not add a row.
    await agent_run_service.notify_run_state(db_session, run, task)
    await db_session.commit()

    messages = await thread_messages(db_session, task.conversation_id)
    assert [meta["event_type"] for _row, meta in messages] == ["waiting_review"]
    row, meta = messages[0]
    assert row.role == "assistant"
    assert row.message_type == "run_update"
    assert row.content.startswith("“Write the launch note” is ready for your review.")
    assert "Result for Draft the launch note" in row.content
    assert meta["action_type"] == "run_update"
    assert meta["run_id"] == run.id
    assert meta["status"] == "waiting_review"
    assert meta["review_id"] is not None
    assert row.idempotency_key.startswith(f"run:{run.id}:")

    await agent_run_service.decide_run(db_session, run.id, ReviewStatus.APPROVED)
    await db_session.commit()
    messages = await thread_messages(db_session, task.conversation_id)
    assert [meta["event_type"] for _row, meta in messages] == ["waiting_review", "approved"]
    assert messages[-1][0].content == "You approved “Write the launch note”. The task is complete."


@pytest.mark.asyncio
async def test_failure_and_input_requests_are_written(db_session, silence_ws):
    _project, _todo, task = await create_project_task(db_session)
    run = await agent_run_service.create_run(db_session, task, provider="openclaw")
    await agent_run_service.mark_starting(db_session, run)
    await agent_run_service.mark_running(db_session, run)
    await agent_run_service.transition_run(
        db_session, run, agent_run_service.AgentRunStatus.WAITING_INPUT, "Which tone?"
    )
    await db_session.commit()
    await agent_run_service.transition_run(
        db_session, run, agent_run_service.AgentRunStatus.RUNNING, "Continuing"
    )
    await agent_run_service.mark_failed(db_session, run, "Provider timeout")
    await db_session.commit()

    messages = await thread_messages(db_session, task.conversation_id)
    assert [meta["event_type"] for _row, meta in messages] == ["waiting_input", "failed"]
    assert messages[0][0].content == (
        "I need your input to continue “Write the launch note”.\n\nWhich tone?"
    )
    assert messages[1][0].content == "“Write the launch note” failed: Provider timeout"


@pytest.mark.asyncio
async def test_thread_update_is_pushed_only_after_commit(db_session, silence_ws, monkeypatch):
    pushed = SimpleNamespace(send_json=AsyncMock())
    monkeypatch.setattr(ws_notifications, "ws_manager", pushed)
    _project, _todo, task = await create_project_task(db_session)
    run = await agent_run_service.create_run(db_session, task, provider="openclaw")
    await agent_run_service.mark_starting(db_session, run)
    await agent_run_service.mark_running(db_session, run)
    await agent_run_service.mark_failed(db_session, run, "boom")
    await asyncio.sleep(0)
    assert pushed.send_json.await_count == 0

    await db_session.commit()
    await asyncio.sleep(0)
    assert pushed.send_json.await_count == 1
    payload = pushed.send_json.await_args.args[1]
    assert payload["type"] == "conversation_updated"
    assert payload["data"]["conversation_id"] == task.conversation_id
    assert payload["data"]["message_id"].startswith("msg_")


@pytest.mark.asyncio
async def test_sub_task_runs_do_not_write_to_the_thread(db_session, silence_ws):
    _project, _todo, task = await create_project_task(db_session)
    sub = AgentTask(
        id="task_thread_sub",
        task_type="research",
        instruction="Find quotes",
        parent_task_id=task.id,
        conversation_id=None,
        agent_type="research",
    )
    db_session.add(sub)
    await db_session.commit()
    run = await agent_run_service.create_run(db_session, sub, provider="openclaw")
    await agent_run_service.mark_starting(db_session, run)
    await agent_run_service.mark_failed(db_session, run, "boom")
    await db_session.commit()

    assert await run_thread_service.post_run_update(db_session, run, sub) is None
    rows = (await db_session.execute(select(Message))).scalars().all()
    assert rows == []
