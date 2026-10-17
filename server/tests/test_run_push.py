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
    for status in ("queued", "starting"):
        assert run_push.push_data({**base, "status": status}) is None
    data = run_push.push_data({**base, "status": "waiting_input", "conversation_id": "c1"})
    assert data == {
        "type": "run_state",
        "status": "waiting_input",
        "run_id": "run_1",
        "title": "Draft the report",
        "todo_id": "todo_1",
        "conversation_id": "c1",
        "push_key": "waiting_input@",
    }
    failed = run_push.push_data({**base, "status": "failed", "error": "boom"})
    assert failed["detail"] == "boom"


def test_a_result_waiting_for_review_carries_its_risk_so_the_phone_can_offer_approve():
    base = {"run_id": "run_1", "title": "Course notices", "review_id": "review_1"}
    low = run_push.push_data({**base, "status": "waiting_review", "risk_level": "low"})
    assert (low["review_id"], low["risk_level"]) == ("review_1", "low")
    unknown = run_push.push_data({**base, "status": "waiting_review", "risk_level": None})
    assert "risk_level" not in unknown


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


def test_progress_is_pushed_quietly_for_top_level_runs_only():
    base = {"run_id": "run_1", "title": "Draft the report"}
    for status in ("running", "completed", "cancelled"):
        assert run_push.push_data({**base, "status": status})["status"] == status
        assert run_push.push_data({**base, "status": status, "parent_task_id": "t2"}) is None


def test_the_phone_gets_the_question_the_risk_and_the_run_s_place():
    base = {"run_id": "run_1", "title": "GPU kernel profiling", "host_label": "MacBook"}
    asking = run_push.push_data(
        {**base, "status": "waiting_input", "progress_message": "Where should the figures go?"}
    )
    assert asking["detail"] == "Where should the figures go?"
    review = run_push.push_data(
        {**base, "status": "waiting_review", "risk_level": "medium", "result_summary": "Two figures"}
    )
    assert (review["risk_level"], review["detail"]) == ("medium", "Two figures")
    running = run_push.push_data(
        {
            **base,
            "status": "running",
            "started_at": "2026-10-17T09:00:00+00:00",
            "progress": 40,
            "step": 3,
            "step_count": 4,
        }
    )
    assert running["host_label"] == "MacBook"
    assert running["started_at_ms"] == "1792227600000"
    assert (running["progress"], running["step"], running["step_count"]) == ("40", "3", "4")
    naive = run_push.push_data({**base, "status": "running", "started_at": "2026-10-17T09:00:00"})
    assert naive["started_at_ms"] == "1792227600000"
    unstarted = run_push.push_data({**base, "status": "running", "progress": 0})
    assert "started_at_ms" not in unstarted and "progress" not in unstarted


class _Session:
    async def __aenter__(self):
        return None

    async def __aexit__(self, *exc):
        return False


async def test_a_second_wait_and_the_reminder_each_push_again():
    fake = _FakePush()
    run_push.configure(fake, lambda: _Session())

    def waiting(since, *, reminder=False):
        return {
            "data": {
                "run_id": "run_1",
                "status": "waiting_input",
                "title": "T",
                "status_since": since,
                "reminder": reminder,
            }
        }

    await run_push.send_for_run_state("user", waiting("09:00"))
    await run_push.send_for_run_state("user", waiting("09:00"))
    await run_push.send_for_run_state("user", waiting("09:00", reminder=True))
    await run_push.send_for_run_state("user", waiting("09:00", reminder=True))
    await run_push.send_for_run_state("user", waiting("10:00"))
    assert [item["data"].get("reminder") for item in fake.sent] == [None, "1", None]


async def test_progress_reaches_the_phone_at_most_once_a_minute(monkeypatch):
    fake = _FakePush()
    run_push.configure(fake, lambda: _Session())
    clock = [1000.0]
    monkeypatch.setattr(run_push.time, "monotonic", lambda: clock[0])
    start = {"data": {"run_id": "run_1", "status": "running", "title": "T", "status_since": "a"}}
    tick = {"data": {**start["data"], "progress": 50, "progress_update": True}}

    await run_push.send_for_run_state("user", start)
    await run_push.send_for_run_state("user", tick)
    assert not run_push.progress_due("run_1")
    clock[0] += 61
    assert run_push.progress_due("run_1")
    await run_push.send_for_run_state("user", tick)
    await run_push.send_for_run_state("user", tick)
    assert [item["data"].get("progress_update") for item in fake.sent] == [None, "1"]


async def test_a_skill_chain_run_reports_its_step(db_session, session_factory):
    run_push.configure(_FakePush(), session_factory)
    task = AgentTask(
        id="task_steps",
        task_type="research",
        instruction="Profile the kernels",
        agent_type="research",
        skill_chain='["research", "summarize", "draft", "plan"]',
    )
    db_session.add(task)
    await db_session.flush()
    run = await agent_run_service.create_run(db_session, task, provider="openclaw")
    task.current_skill_index = 2  # the executor is on the third skill
    payload = await agent_run_service._run_state_payload(db_session, run, task)
    assert (payload["step"], payload["step_count"]) == (3, 4)
