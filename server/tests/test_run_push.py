"""Runs that stop for the user reach the phone as a data-only push, once."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from domain.agent_run import AgentRunStatus
from models.agent_run import AgentRun
from models.agent_task import AgentTask
from models.todo import Todo
from services.agents import agent_run_service
from services.notifications import run_push


class _FakePush:
    enabled = True

    def __init__(self) -> None:
        self.sent: list[dict] = []

    async def send_to_all_devices(self, _db, title="", body="", data=None, *, data_only=False):
        self.sent.append({"data": data, "data_only": data_only})
        return 1


@pytest.fixture(autouse=True)
def reset_run_push(monkeypatch):
    monkeypatch.setattr(agent_run_service, "ws_manager", SimpleNamespace(send_json=AsyncMock()))
    run_push._reset_for_tests()
    yield
    run_push._reset_for_tests()


def test_only_states_that_need_the_user_are_pushed():
    base = {"run_id": "run_1", "title": "Draft the report", "todo_id": "todo_1"}
    for status in ("queued", "running", "completed", "cancelled"):
        assert run_push.push_data({**base, "status": status}) is None
    data = run_push.push_data({**base, "status": "waiting_input", "conversation_id": "c1"})
    assert data == {
        "type": "run_state",
        "status": "waiting_input",
        "run_id": "run_1",
        "title": "Draft the report",
        "todo_id": "todo_1",
        "conversation_id": "c1",
    }
    failed = run_push.push_data({**base, "status": "failed", "error": "boom"})
    assert failed["detail"] == "boom"


async def test_a_status_is_pushed_once_per_run():
    fake = _FakePush()

    class _Session:
        async def __aenter__(self):
            return None

        async def __aexit__(self, *exc):
            return False

    run_push.configure(fake, lambda: _Session())
    message = {"data": {"run_id": "run_1", "status": "waiting_review", "title": "T"}}
    await run_push.send_for_run_state("user", message)
    await run_push.send_for_run_state("user", message)
    await run_push.send_for_run_state(
        "user", {"data": {"run_id": "run_1", "status": "failed", "title": "T"}}
    )
    assert [item["data"]["status"] for item in fake.sent] == ["waiting_review", "failed"]
    assert all(item["data_only"] for item in fake.sent)


async def test_disabled_push_sends_nothing():
    fake = _FakePush()
    fake.enabled = False
    run_push.configure(fake, lambda: None)
    await run_push.send_for_run_state("user", {"data": {"run_id": "r", "status": "failed"}})
    assert fake.sent == []


async def test_a_run_waiting_for_input_pushes_after_commit(db_session, session_factory):
    fake = _FakePush()
    run_push.configure(fake, session_factory)
    todo = Todo(id="todo_push", title="Pick a venue")
    db_session.add(todo)
    await db_session.flush()
    task = AgentTask(
        id="task_push",
        task_type="research",
        instruction="Pick a venue",
        todo_id=todo.id,
        agent_type="research",
    )
    db_session.add(task)
    await db_session.flush()
    run = await agent_run_service.create_run(db_session, task, provider="openclaw")
    await db_session.commit()

    run.status = AgentRunStatus.WAITING_INPUT
    await agent_run_service.notify_run_state(db_session, run, task)
    assert fake.sent == []  # nothing before the commit
    await db_session.commit()
    for _ in range(20):
        if fake.sent:
            break
        await asyncio.sleep(0.01)
    assert len(fake.sent) == 1
    data = fake.sent[0]["data"]
    assert (data["status"], data["run_id"], data["title"]) == (
        "waiting_input",
        run.id,
        "Pick a venue",
    )
    assert isinstance(run, AgentRun)
