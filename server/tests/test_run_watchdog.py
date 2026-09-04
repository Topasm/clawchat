"""Silent runs are failed so they can be retried; waiting runs are asked again."""

import asyncio
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from domain.agent_run import AgentRunStatus
from models.agent_run import AgentRunEvent
from models.agent_task import AgentTask
from models.message import Message
from models.todo import Todo
from services.agents import agent_run_service, run_watchdog_service

NOW = datetime(2026, 9, 4, 12, 0, tzinfo=timezone.utc)
TIMEOUT = timedelta(minutes=10)
REMIND_AFTER = timedelta(minutes=30)


@pytest.fixture(autouse=True)
def silence_ws(monkeypatch):
    monkeypatch.setattr(agent_run_service, "ws_manager", SimpleNamespace(send_json=AsyncMock()))


async def make_run(db_session, suffix: str, *, status: AgentRunStatus, heartbeat_age: timedelta):
    todo = Todo(id=f"todo_{suffix}", title=f"Task {suffix}")
    db_session.add(todo)
    await db_session.flush()
    task = AgentTask(
        id=f"task_{suffix}",
        task_type="research",
        instruction=f"Do {suffix}",
        todo_id=todo.id,
        agent_type="research",
    )
    db_session.add(task)
    await db_session.flush()
    run = await agent_run_service.create_run(db_session, task, provider="claude_code")
    run.status = status
    run.started_at = NOW - heartbeat_age - timedelta(minutes=1)
    run.heartbeat_at = NOW - heartbeat_age
    if status == AgentRunStatus.WAITING_INPUT:
        run.progress_message = "Which branch?"
    await db_session.commit()
    return run, task


async def sweep(db_session):
    report = await run_watchdog_service.sweep(
        db_session, now=NOW, heartbeat_timeout=TIMEOUT, remind_after=REMIND_AFTER
    )
    await db_session.commit()
    return report


@pytest.mark.asyncio
async def test_a_run_nobody_is_executing_fails_once_its_heartbeat_lapses(db_session):
    stale, stale_task = await make_run(
        db_session, "stale", status=AgentRunStatus.RUNNING, heartbeat_age=timedelta(minutes=11)
    )
    fresh, _ = await make_run(
        db_session, "fresh", status=AgentRunStatus.RUNNING, heartbeat_age=timedelta(minutes=2)
    )
    queued, _ = await make_run(
        db_session, "queued", status=AgentRunStatus.QUEUED, heartbeat_age=timedelta(hours=3)
    )

    report = await sweep(db_session)

    assert report.failed_run_ids == [stale.id]
    await db_session.refresh(stale)
    await db_session.refresh(fresh)
    await db_session.refresh(queued)
    assert stale.status == "failed"
    assert "No heartbeat for 10 minutes" in stale.error
    assert stale_task.status == "failed"
    assert fresh.status == "running"
    assert queued.status == "queued"
    thread = (await db_session.execute(select(Message).where(
        Message.conversation_id == stale_task.conversation_id
    ))).scalars().all()
    assert len(thread) == 1
    assert thread[0].content.startswith("“Task stale” failed: No heartbeat")


@pytest.mark.asyncio
async def test_a_run_this_process_is_executing_is_never_failed_by_heartbeat(db_session):
    live, _ = await make_run(
        db_session, "live", status=AgentRunStatus.RUNNING, heartbeat_age=timedelta(hours=1)
    )
    blocked = asyncio.Event()

    async def worker():
        await blocked.wait()

    agent_run_service.launch_execution(live.id, worker())
    try:
        report = await sweep(db_session)
        assert report.failed_run_ids == []
        await db_session.refresh(live)
        assert live.status == "running"
    finally:
        blocked.set()
        await asyncio.sleep(0)


@pytest.mark.asyncio
async def test_a_waiting_run_is_reminded_once(db_session):
    waiting, task = await make_run(
        db_session, "waiting", status=AgentRunStatus.WAITING_INPUT,
        heartbeat_age=timedelta(minutes=45),
    )
    recent, _ = await make_run(
        db_session, "recent", status=AgentRunStatus.WAITING_INPUT,
        heartbeat_age=timedelta(minutes=5),
    )

    first = await sweep(db_session)
    second = await sweep(db_session)

    assert first.reminded_run_ids == [waiting.id]
    assert second.reminded_run_ids == []
    await db_session.refresh(waiting)
    await db_session.refresh(recent)
    assert waiting.status == "waiting_input"
    assert recent.status == "waiting_input"
    reminders = (await db_session.execute(select(AgentRunEvent).where(
        AgentRunEvent.run_id == waiting.id,
        AgentRunEvent.event_type == run_watchdog_service.WAITING_REMINDER_EVENT,
    ))).scalars().all()
    assert len(reminders) == 1
    assert reminders[0].message == "Still waiting for your input after 45 minutes"
    thread = (await db_session.execute(select(Message).where(
        Message.conversation_id == task.conversation_id
    ))).scalars().all()
    assert [json.loads(m.metadata_json)["event_type"] for m in thread] == ["waiting_reminder"]
    assert thread[0].content == (
        "Still waiting on your answer to continue “Task waiting”.\n\nWhich branch?"
    )
    pushed = [
        call.args[1]["data"]
        for call in agent_run_service.ws_manager.send_json.await_args_list
        if call.args[1]["type"] == "run_state_changed"
    ]
    assert [event["status"] for event in pushed if event["run_id"] == waiting.id] == [
        "waiting_input"
    ]
