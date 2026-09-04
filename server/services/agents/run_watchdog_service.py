"""Notice runs that stopped reporting, and runs that are still waiting on you.

Two things used to go unnoticed for as long as nobody opened the Runs page:
a run whose worker died stayed ``running`` forever (nothing watched the
heartbeat the worker was told to send), and a run parked in ``waiting_input``
never asked again. Both are the agent silently stalled -- the opposite of
working together.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from domain.agent_run import AgentRunStatus
from models.agent_run import AgentRun, AgentRunEvent
from models.agent_task import AgentTask
from services.agents import agent_run_service
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

WAITING_REMINDER_EVENT = "waiting_reminder"


@dataclass
class WatchdogReport:
    failed_run_ids: list[str] = field(default_factory=list)
    reminded_run_ids: list[str] = field(default_factory=list)


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


async def _latest_event_type(db: AsyncSession, run_id: str) -> str | None:
    return (
        await db.execute(
            select(AgentRunEvent.event_type)
            .where(AgentRunEvent.run_id == run_id)
            .order_by(AgentRunEvent.sequence.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def fail_silent_runs(
    db: AsyncSession,
    *,
    now: datetime,
    heartbeat_timeout: timedelta,
) -> list[str]:
    """Fail started runs nothing is executing whose heartbeat has lapsed.

    A run this process is executing is alive whatever its heartbeat says; a
    Paseo monitor and a desktop worker both refresh the heartbeat while they
    live, so a lapse with no local coroutine means the process behind the run
    is gone. Queued runs are not started yet and are left for their host.
    """
    runs = list(
        (
            await db.execute(
                select(AgentRun).where(
                    AgentRun.status.in_(
                        (AgentRunStatus.STARTING, AgentRunStatus.RUNNING)
                    )
                )
            )
        ).scalars().all()
    )
    failed: list[str] = []
    for run in runs:
        if agent_run_service.is_execution_registered(run.id):
            continue
        last_seen = _aware(run.heartbeat_at) or _aware(run.started_at) or _aware(run.created_at)
        if last_seen is None or now - last_seen < heartbeat_timeout:
            continue
        minutes = int(heartbeat_timeout.total_seconds() // 60)
        error = (
            f"No heartbeat for {minutes} minutes; the machine running this work "
            "may be offline. Retry is available."
        )
        task = await db.get(AgentTask, run.agent_task_id)
        if task is not None:
            task.status = "failed"
            task.error = error
            task.completed_at = now
        await agent_run_service.mark_failed(db, run, error)
        failed.append(run.id)
        logger.warning("Agent run %s failed by watchdog: %s", run.id, error)
    return failed


async def remind_waiting_runs(
    db: AsyncSession,
    *,
    now: datetime,
    remind_after: timedelta,
) -> list[str]:
    """Ask once more for runs that have waited for input past the threshold.

    One reminder per wait: the reminder is itself the run's latest event, so a
    run already reminded is skipped until something else happens to it.
    """
    runs = list(
        (
            await db.execute(
                select(AgentRun).where(AgentRun.status == AgentRunStatus.WAITING_INPUT)
            )
        ).scalars().all()
    )
    reminded: list[str] = []
    for run in runs:
        waiting_since = _aware(run.heartbeat_at) or _aware(run.started_at)
        if waiting_since is None or now - waiting_since < remind_after:
            continue
        if await _latest_event_type(db, run.id) == WAITING_REMINDER_EVENT:
            continue
        minutes = int((now - waiting_since).total_seconds() // 60)
        await agent_run_service.record_event(
            db,
            run,
            WAITING_REMINDER_EVENT,
            f"Still waiting for your input after {minutes} minutes",
            progress=run.progress,
        )
        await agent_run_service.notify_run_state(db, run)
        reminded.append(run.id)
    return reminded


async def sweep(
    db: AsyncSession,
    *,
    now: datetime | None = None,
    heartbeat_timeout: timedelta,
    remind_after: timedelta,
) -> WatchdogReport:
    """One pass of both checks. The caller commits."""
    now = now or datetime.now(timezone.utc)
    return WatchdogReport(
        failed_run_ids=await fail_silent_runs(db, now=now, heartbeat_timeout=heartbeat_timeout),
        reminded_run_ids=await remind_waiting_runs(db, now=now, remind_after=remind_after),
    )
