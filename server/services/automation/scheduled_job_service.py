"""Scheduled AI jobs: standing instructions the server runs on a schedule.

Each firing becomes an ordinary agent task and run. Its instruction carries a
snapshot of the user's tasks, its result goes to the review queue, and it
posts into one thread per job, so each report can see the previous ones.
"""

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any

from domain.agent_run import AGENT_RUN_EXECUTING_STATUSES
from exceptions import AppError, ConflictError, NotFoundError, ValidationError
from models.agent_run import AgentRun
from models.agent_task import AgentTask
from models.conversation import Conversation
from models.project import Project
from models.scheduled_job import ScheduledJob
from schemas.scheduled_job import (
    ScheduledJobCreate,
    ScheduledJobResponse,
    ScheduledJobUpdate,
)
from services.agents import agent_run_service, agent_task_service
from services.agents.run_resume_service import active_provider
from services.automation import job_schedule
from services.automation.task_snapshot import build_task_snapshot
from skills import SKILL_REGISTRY
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from utils import make_id
from ws.manager import ws_manager
from ws.notifications import DEFAULT_USER_ID, notify_module_data_changed

logger = logging.getLogger(__name__)

TASK_TYPE = "scheduled_job"
# The loop sleeps until the next job is due; the ceiling bounds how late a job
# can fire if a wake-up is ever missed.
MAX_WAIT_SECONDS = 60 * 60.0
MIN_WAIT_SECONDS = 1.0

_jobs_changed: asyncio.Event | None = None


def watch_jobs() -> asyncio.Event:
    """Start a fresh watch for the loop's next pass (armed before it runs)."""
    global _jobs_changed
    _jobs_changed = asyncio.Event()
    return _jobs_changed


def wake_jobs() -> None:
    """Have the loop re-plan now, e.g. after a job was created or rescheduled."""
    if _jobs_changed is not None:
        _jobs_changed.set()


async def wait_for_jobs(watch: asyncio.Event, timeout: float) -> None:
    try:
        await asyncio.wait_for(watch.wait(), timeout)
    except TimeoutError:
        pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _utc(moment: datetime) -> datetime:
    # SQLite hands back naive datetimes for values stored in UTC.
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def _validated_chain(chain: list[str]) -> str:
    unknown = [skill for skill in chain if skill not in SKILL_REGISTRY]
    if unknown:
        raise ValidationError(
            "Unknown skill", details={"skills": unknown}
        )
    return json.dumps(chain)


def _validated_schedule(rrule: str, zone: str, anchor: datetime) -> None:
    try:
        job_schedule.validate(rrule, zone, anchor=anchor)
    except job_schedule.ScheduleError as exc:
        raise ValidationError(str(exc)) from exc


def _next_run(job: ScheduledJob, after: datetime) -> datetime | None:
    if not job.enabled:
        return None
    return job_schedule.next_occurrence(
        job.rrule, job.timezone, anchor=_utc(job.created_at), after=after
    )


async def _project(db: AsyncSession, project_id: str | None) -> Project | None:
    if project_id is None:
        return None
    project = await db.get(Project, project_id)
    if project is None:
        raise NotFoundError("Project not found")
    return project


async def _sync_thread(
    db: AsyncSession, job: ScheduledJob, project: Project | None
) -> None:
    """Keep the job's thread named and scoped like the job."""
    conversation = (
        await db.get(Conversation, job.conversation_id) if job.conversation_id else None
    )
    if conversation is None:
        conversation = Conversation(
            id=make_id("conv_"),
            metadata_json=json.dumps({"origin": "scheduled_job", "scheduled_job_id": job.id}),
        )
        db.add(conversation)
        job.conversation_id = conversation.id
    conversation.title = job.title[:80]
    conversation.project_id = project.id if project else None
    conversation.project_todo_id = project.root_task_id if project else None


async def require_job(db: AsyncSession, job_id: str) -> ScheduledJob:
    job = await db.get(ScheduledJob, job_id)
    if job is None:
        raise NotFoundError("Scheduled job not found")
    return job


async def build_response(db: AsyncSession, job: ScheduledJob) -> ScheduledJobResponse:
    project = await db.get(Project, job.project_id) if job.project_id else None
    last_run = await db.get(AgentRun, job.last_run_id) if job.last_run_id else None
    return ScheduledJobResponse(
        id=job.id,
        title=job.title,
        instruction=job.instruction,
        skill_chain=json.loads(job.skill_chain),
        project_id=job.project_id,
        project_title=project.title if project else None,
        include_task_snapshot=job.include_task_snapshot,
        rrule=job.rrule,
        timezone=job.timezone,
        enabled=job.enabled,
        next_run_at=_utc(job.next_run_at) if job.next_run_at else None,
        conversation_id=job.conversation_id,
        last_run_at=_utc(job.last_run_at) if job.last_run_at else None,
        last_run_id=job.last_run_id,
        last_run_status=last_run.status if last_run else None,
        last_error=job.last_error,
        created_at=_utc(job.created_at),
        updated_at=_utc(job.updated_at),
    )


async def list_jobs(db: AsyncSession) -> list[ScheduledJob]:
    return list(
        (
            await db.execute(select(ScheduledJob).order_by(ScheduledJob.created_at))
        ).scalars()
    )


async def create_job(db: AsyncSession, body: ScheduledJobCreate) -> ScheduledJob:
    now = _now()
    project = await _project(db, body.project_id)
    _validated_schedule(body.rrule, body.timezone, now)
    job = ScheduledJob(
        id=make_id("sjob_"),
        title=body.title.strip(),
        instruction=body.instruction.strip(),
        skill_chain=_validated_chain(body.skill_chain),
        project_id=project.id if project else None,
        include_task_snapshot=body.include_task_snapshot,
        rrule=body.rrule.strip(),
        timezone=body.timezone,
        enabled=body.enabled,
        created_at=now,
        updated_at=now,
    )
    job.next_run_at = _next_run(job, now)
    db.add(job)
    await _sync_thread(db, job, project)
    await db.commit()
    wake_jobs()
    return job


async def update_job(
    db: AsyncSession, job_id: str, body: ScheduledJobUpdate
) -> ScheduledJob:
    job = await require_job(db, job_id)
    fields = body.model_fields_set
    if "title" in fields and body.title is not None:
        job.title = body.title.strip()
    if "instruction" in fields and body.instruction is not None:
        job.instruction = body.instruction.strip()
    if "skill_chain" in fields and body.skill_chain is not None:
        job.skill_chain = _validated_chain(body.skill_chain)
    if "include_task_snapshot" in fields and body.include_task_snapshot is not None:
        job.include_task_snapshot = body.include_task_snapshot
    if "project_id" in fields:
        project = await _project(db, body.project_id)
        job.project_id = project.id if project else None
    if "rrule" in fields and body.rrule is not None:
        job.rrule = body.rrule.strip()
    if "timezone" in fields and body.timezone is not None:
        job.timezone = body.timezone
    if "enabled" in fields and body.enabled is not None:
        job.enabled = body.enabled
    if fields & {"rrule", "timezone", "enabled"}:
        _validated_schedule(job.rrule, job.timezone, _utc(job.created_at))
        job.next_run_at = _next_run(job, _now())
    await _sync_thread(db, job, await _project(db, job.project_id))
    await db.commit()
    wake_jobs()
    return job


async def delete_job(db: AsyncSession, job_id: str) -> None:
    # The thread and past runs stay: they are the job's history.
    await db.delete(await require_job(db, job_id))
    await db.commit()
    wake_jobs()


async def _instruction(
    db: AsyncSession, job: ScheduledJob, *, now: datetime, trigger: str
) -> str:
    zone = job_schedule.parse_zone(job.timezone)
    local = now.astimezone(zone).strftime("%A %Y-%m-%d %H:%M %Z")
    parts = [
        f'Scheduled job "{job.title}" ({trigger} run, {local}).',
        job.instruction,
    ]
    if job.include_task_snapshot:
        snapshot = await build_task_snapshot(
            db,
            project=await db.get(Project, job.project_id) if job.project_id else None,
            since=_utc(job.last_run_at) if job.last_run_at else None,
            zone=zone,
            now=now,
        )
        parts += [
            snapshot,
            "Work from this snapshot. If something you need is not in it, say so "
            "instead of guessing.",
        ]
    return "\n\n".join(parts)


async def fire_job(
    db: AsyncSession,
    job: ScheduledJob,
    app_state: Any,
    *,
    trigger: str,
    now: datetime | None = None,
) -> AgentRun:
    """Start one run of ``job`` and return it. Commits."""
    now = now or _now()
    if job.last_run_id:
        previous = await db.get(AgentRun, job.last_run_id)
        if previous is not None and previous.status in AGENT_RUN_EXECUTING_STATUSES:
            raise ConflictError("The previous run of this job is still working")
    provider, ai, model = active_provider(app_state)
    session_factory = getattr(app_state, "session_factory", None)
    if session_factory is None:
        raise ConflictError("The server cannot start background work right now")

    await _sync_thread(db, job, await db.get(Project, job.project_id) if job.project_id else None)
    chain = json.loads(job.skill_chain)
    task = AgentTask(
        id=make_id("task_"),
        task_type=TASK_TYPE,
        agent_type=chain[0],
        instruction=await _instruction(db, job, now=now, trigger=trigger),
        skill_chain=job.skill_chain,
        conversation_id=job.conversation_id,
        payload_json=json.dumps(
            {"scheduled_job_id": job.id, "trigger": trigger, "fired_at": now.isoformat()}
        ),
    )
    db.add(task)
    await db.flush()
    run = await agent_run_service.create_run(
        db, task, provider=provider, model=model, update_todo_status=False
    )
    job.last_run_at = now
    job.last_run_id = run.id
    job.last_error = None
    await db.commit()

    task_id, run_id = task.id, run.id

    async def execute() -> None:
        async with session_factory() as run_db:
            run_task = await run_db.get(AgentTask, task_id)
            run_row = await run_db.get(AgentRun, run_id)
            if run_task is None or run_row is None:
                return
            await agent_task_service.execute_task(
                run_db,
                run_task,
                ai,
                ws_manager,
                DEFAULT_USER_ID,
                session_factory=session_factory,
                run=run_row,
                provider=provider,
                model=model,
            )
        await notify_module_data_changed("runs")
        await notify_module_data_changed("reviews")

    agent_run_service.launch_execution(run_id, execute())
    await notify_module_data_changed("runs")
    return run


async def run_due_jobs(
    session_factory: Any, app_state: Any, *, now: datetime | None = None
) -> float:
    """Fire every job that is due; return how long the loop may sleep."""
    now = now or _now()
    async with session_factory() as db:
        due_ids = list(
            (
                await db.execute(
                    select(ScheduledJob.id)
                    .where(ScheduledJob.enabled.is_(True), ScheduledJob.next_run_at <= now)
                    .order_by(ScheduledJob.next_run_at)
                )
            ).scalars()
        )
        # Reload each job by id: a failed firing rolls back and expires the rest.
        for job_id in due_ids:
            job = await db.get(ScheduledJob, job_id)
            if job is None:
                continue
            # Advance before firing: a failed firing waits for its next slot,
            # and a server that was down fires once, not once per missed slot.
            job.next_run_at = _next_run(job, now)
            await db.commit()
            try:
                await fire_job(db, job, app_state, trigger="scheduled", now=now)
            except Exception as exc:
                await db.rollback()
                if not isinstance(exc, AppError):
                    logger.exception("Scheduled job %s failed to start", job_id)
                failed = await db.get(ScheduledJob, job_id)
                if failed is not None:
                    failed.last_error = exc.message if isinstance(exc, AppError) else str(exc)
                    await db.commit()
        upcoming = (
            await db.execute(
                select(func.min(ScheduledJob.next_run_at)).where(
                    ScheduledJob.enabled.is_(True)
                )
            )
        ).scalar()
    if upcoming is None:
        return MAX_WAIT_SECONDS
    wait = (_utc(upcoming) - _now()).total_seconds()
    return min(max(wait, MIN_WAIT_SECONDS), MAX_WAIT_SECONDS)


async def scheduled_job_loop(app_state: Any) -> None:
    """Fire scheduled jobs as they come due, sleeping in between."""
    while True:
        watch = watch_jobs()
        wait = MAX_WAIT_SECONDS
        try:
            wait = await run_due_jobs(app_state.session_factory, app_state)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Scheduled job pass failed")
        await wait_for_jobs(watch, wait)
