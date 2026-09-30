import asyncio
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from domain.agent_run import AgentRunStatus
from domain.review import ReviewSubjectType
from domain.task import TaskStatus
from domain.task_relationship import TaskRelationshipType
from models.agent_run import AgentRun
from models.agent_task import AgentTask
from models.project import Project
from models.review_item import ReviewItem
from models.scheduled_job import ScheduledJob
from models.task_relationship import TaskRelationship
from models.todo import Todo
from schemas.scheduled_job import ScheduledJobCreate, ScheduledJobUpdate
from services.agents import agent_run_service
from services.automation import scheduled_job_service as jobs
from services.automation.task_snapshot import build_task_snapshot
from services.automation.job_schedule import parse_zone
from sqlalchemy import select

WEEKLY_MONDAY_9 = "FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0"


class ReportingAI:
    model = "fake-model"

    def __init__(self):
        self.messages: list[str] = []

    async def generate_completion(self, *, system_prompt, user_message):
        self.messages.append(user_message)
        return "Status: launch prep is blocked on the review."


async def _project_with_tasks(db, now: datetime) -> Project:
    root = Todo(id="todo_root", title="Launch", status=TaskStatus.PENDING)
    done = Todo(
        id="todo_done",
        title="Write copy",
        parent_id=root.id,
        status=TaskStatus.COMPLETED,
        completed_at=now - timedelta(days=1),
    )
    ready = Todo(id="todo_ready", title="Review copy", parent_id=root.id)
    blocked = Todo(id="todo_blocked", title="Publish", parent_id=root.id)
    late = Todo(
        id="todo_late",
        title="Book venue",
        parent_id=root.id,
        due_date=now - timedelta(days=2),
    )
    db.add_all([root, done, ready, blocked, late])
    await db.flush()
    db.add(
        TaskRelationship(
            id="rel_publish_review",
            source_task_id=blocked.id,
            target_task_id=ready.id,
            type=TaskRelationshipType.DEPENDS_ON,
        )
    )
    project = Project(id="proj_launch", title="Launch", root_task_id=root.id)
    db.add(project)
    await db.commit()
    return project


def _state(session_factory, ai=None):
    return SimpleNamespace(
        active_ai=ai,
        active_ai_provider="openclaw",
        session_factory=session_factory,
    )


async def _settled(db, run_id: str) -> AgentRun:
    for _ in range(200):
        await asyncio.sleep(0.01)
        db.expire_all()
        run = await db.get(AgentRun, run_id)
        if (
            run.status not in (AgentRunStatus.QUEUED, AgentRunStatus.STARTING, AgentRunStatus.RUNNING)
            and not agent_run_service.is_execution_registered(run_id)
        ):
            return run
    raise AssertionError("the scheduled run did not finish")


async def test_snapshot_names_blockers_deadlines_and_recent_work(db_session):
    now = datetime(2026, 9, 30, 12, tzinfo=timezone.utc)
    project = await _project_with_tasks(db_session, now)

    text = await build_task_snapshot(
        db_session, project=project, since=now - timedelta(days=7),
        zone=parse_zone("Asia/Seoul"), now=now,
    )

    assert 'Task snapshot: project "Launch"' in text
    assert "## Ready to start" in text and "- Review copy" in text
    assert "- Publish — waiting on: Review copy" in text
    assert "## Overdue (1)" in text and "Book venue" in text
    assert "## Completed since" in text and "- Write copy" in text
    # The project's own root task is the container, not an item of work.
    assert "- Launch" not in text


async def test_creating_a_job_schedules_it_in_the_users_time_zone(client, auth_headers):
    response = await client.post(
        "/api/scheduled-jobs",
        headers=auth_headers,
        json={
            "title": "Weekly status",
            "instruction": "Draft a short status update.",
            "skill_chain": ["draft"],
            "rrule": WEEKLY_MONDAY_9,
            "timezone": "Asia/Seoul",
        },
    )
    assert response.status_code == 201, response.text
    job = response.json()
    next_run = datetime.fromisoformat(job["next_run_at"]).astimezone(parse_zone("Asia/Seoul"))
    assert (next_run.weekday(), next_run.hour, next_run.minute) == (0, 9, 0)
    assert job["conversation_id"]

    listed = (await client.get("/api/scheduled-jobs", headers=auth_headers)).json()
    assert [item["id"] for item in listed["jobs"]] == [job["id"]]


async def test_rejects_schedules_and_skills_it_cannot_run(client, auth_headers):
    base = {
        "title": "Too often",
        "instruction": "x",
        "skill_chain": ["draft"],
        "rrule": WEEKLY_MONDAY_9,
        "timezone": "Asia/Seoul",
    }
    for change in (
        {"rrule": "FREQ=MINUTELY"},
        {"rrule": "FREQ=DAILY;BYHOUR=9,9;BYMINUTE=0,15"},
        {"timezone": "Mars/Olympus"},
        {"skill_chain": ["no_such_skill"]},
    ):
        response = await client.post(
            "/api/scheduled-jobs", headers=auth_headers, json={**base, **change}
        )
        assert response.status_code == 400, (change, response.text)


async def test_a_due_job_runs_on_the_task_snapshot_into_review(
    db_session, session_factory
):
    now = datetime.now(timezone.utc)
    project = await _project_with_tasks(db_session, now)
    job = await jobs.create_job(
        db_session,
        ScheduledJobCreate(
            title="Weekly status",
            instruction="Draft this week's status update.",
            skill_chain=["draft"],
            project_id=project.id,
            rrule=WEEKLY_MONDAY_9,
            timezone="Asia/Seoul",
        ),
    )
    job.next_run_at = now - timedelta(minutes=1)
    await db_session.commit()
    job_id = job.id
    ai = ReportingAI()

    await jobs.run_due_jobs(session_factory, _state(session_factory, ai), now=now)

    db_session.expire_all()
    job = await db_session.get(ScheduledJob, job_id)
    assert job.last_run_id and job.last_error is None
    assert jobs._utc(job.next_run_at) > now
    thread_id = job.conversation_id
    run = await _settled(db_session, job.last_run_id)
    assert run.status == AgentRunStatus.WAITING_REVIEW
    assert run.project_id == "proj_launch"
    task = await db_session.get(AgentTask, run.agent_task_id)
    assert task.task_type == "scheduled_job"
    assert task.conversation_id == thread_id
    assert json.loads(task.payload_json)["scheduled_job_id"] == job_id
    review = (
        await db_session.execute(
            select(ReviewItem).where(
                ReviewItem.subject_type == ReviewSubjectType.AGENT_RUN,
                ReviewItem.subject_id == run.id,
            )
        )
    ).scalar_one()
    assert review.project_id == "proj_launch"
    prompt = ai.messages[0]
    assert "Draft this week's status update." in prompt
    assert "Publish — waiting on: Review copy" in prompt


async def test_missed_slots_fire_once_and_a_busy_job_waits(db_session, session_factory):
    now = datetime.now(timezone.utc)
    job = await jobs.create_job(
        db_session,
        ScheduledJobCreate(
            title="Evening check",
            instruction="List what is blocked.",
            skill_chain=["summarize"],
            rrule="FREQ=DAILY;BYHOUR=18;BYMINUTE=0",
            timezone="Asia/Seoul",
        ),
    )
    job.next_run_at = now - timedelta(days=21)
    await db_session.commit()
    job_id = job.id
    state = _state(session_factory, ReportingAI())

    await jobs.run_due_jobs(session_factory, state, now=now)
    runs = (await db_session.execute(select(AgentRun))).scalars().all()
    assert len(runs) == 1
    await _settled(db_session, runs[0].id)

    # The next slot comes around while the last run is somehow still working.
    runs[0].status = AgentRunStatus.RUNNING
    job = await db_session.get(ScheduledJob, job_id)
    job.next_run_at = now - timedelta(minutes=1)
    await db_session.commit()
    await jobs.run_due_jobs(session_factory, state, now=now)

    db_session.expire_all()
    assert len((await db_session.execute(select(AgentRun))).scalars().all()) == 1
    job = await db_session.get(ScheduledJob, job_id)
    assert job.last_error == "The previous run of this job is still working"
    assert jobs._utc(job.next_run_at) > now


async def test_without_an_ai_provider_the_job_records_why(db_session, session_factory):
    now = datetime.now(timezone.utc)
    job = await jobs.create_job(
        db_session,
        ScheduledJobCreate(
            title="Status",
            instruction="x",
            skill_chain=["draft"],
            rrule=WEEKLY_MONDAY_9,
            timezone="UTC",
        ),
    )
    job.next_run_at = now - timedelta(minutes=1)
    await db_session.commit()
    job_id = job.id

    await jobs.run_due_jobs(session_factory, _state(session_factory, None), now=now)

    db_session.expire_all()
    job = await db_session.get(ScheduledJob, job_id)
    assert job.last_error == "No execution provider is available"
    assert (await db_session.execute(select(AgentTask))).scalars().first() is None


async def test_disabling_clears_the_next_run_and_enabling_restores_it(db_session):
    job = await jobs.create_job(
        db_session,
        ScheduledJobCreate(
            title="Status",
            instruction="x",
            skill_chain=["draft"],
            rrule=WEEKLY_MONDAY_9,
            timezone="UTC",
        ),
    )
    job = await jobs.update_job(db_session, job.id, ScheduledJobUpdate(enabled=False))
    assert job.next_run_at is None
    job = await jobs.update_job(db_session, job.id, ScheduledJobUpdate(enabled=True))
    assert job.next_run_at is not None


async def test_the_loop_wakes_when_a_job_changes():
    watch = jobs.watch_jobs()
    sleeper = asyncio.ensure_future(jobs.wait_for_jobs(watch, 60))
    await asyncio.sleep(0)
    jobs.wake_jobs()
    await asyncio.wait_for(sleeper, 1)


async def test_deleting_the_project_removes_its_jobs(db_session):
    project = await _project_with_tasks(db_session, datetime.now(timezone.utc))
    job = await jobs.create_job(
        db_session,
        ScheduledJobCreate(
            title="Status",
            instruction="x",
            skill_chain=["draft"],
            project_id=project.id,
            rrule=WEEKLY_MONDAY_9,
            timezone="UTC",
        ),
    )
    job_id = job.id
    from services.tasks import project_service

    await project_service.delete_project(db_session, "proj_launch")
    await db_session.commit()

    db_session.expire_all()
    assert await db_session.get(ScheduledJob, job_id) is None


async def test_run_now_starts_a_run_without_moving_the_schedule(
    client, auth_headers, session_factory, monkeypatch
):
    from main import app

    for name, value in vars(_state(session_factory, ReportingAI())).items():
        monkeypatch.setattr(app.state, name, value, raising=False)
    created = (
        await client.post(
            "/api/scheduled-jobs",
            headers=auth_headers,
            json={
                "title": "Status",
                "instruction": "Summarize open work.",
                "skill_chain": ["summarize"],
                "rrule": WEEKLY_MONDAY_9,
                "timezone": "UTC",
            },
        )
    ).json()

    response = await client.post(
        f"/api/scheduled-jobs/{created['id']}/run", headers=auth_headers
    )

    assert response.status_code == 202, response.text
    body = response.json()
    assert body["conversation_id"] == created["conversation_id"]
    async with session_factory() as db:
        await _settled(db, body["run_id"])
    after = (await client.get("/api/scheduled-jobs", headers=auth_headers)).json()["jobs"][0]
    assert after["next_run_at"] == created["next_run_at"]
    assert after["last_run_id"] == body["run_id"]
    assert after["last_run_status"] == "waiting_review"
