"""Choosing the machine a project's work runs on."""

import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from config import settings
from database import Base
from exceptions import ValidationError
from models.execution_host import ExecutionHost, ProjectHostPath
from models.project import Project
from services.agents import execution_host_service
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

UTC = timezone.utc


async def _project(db, **overrides) -> Project:
    project = Project(title="Experiments", **overrides)
    db.add(project)
    await db.flush()
    return project


async def _host(db, **overrides) -> ExecutionHost:
    defaults = dict(label="Workstation", kind="local")
    defaults.update(overrides)
    host = ExecutionHost(**defaults)
    db.add(host)
    await db.flush()
    return host


async def _bind(db, project: Project, host: ExecutionHost, path: str) -> None:
    db.add(ProjectHostPath(project_id=project.id, host_id=host.id, path=path))
    project.execution_host_id = host.id
    await db.flush()


# --- availability ---------------------------------------------------------


def test_a_local_host_can_only_run_paths_that_exist_here(tmp_path):
    host = ExecutionHost(label="Workstation", kind="local", is_enabled=True)

    assert execution_host_service.host_is_available(host, str(tmp_path)) is True
    # The decisive case: a laptop path recorded against this machine.
    assert execution_host_service.host_is_available(host, "/Users/someone/papers") is False


def test_a_disabled_host_takes_no_work(tmp_path):
    host = ExecutionHost(label="Workstation", kind="local", is_enabled=False)

    assert execution_host_service.host_is_available(host, str(tmp_path)) is False


def test_a_remote_host_goes_quiet_after_the_heartbeat_grace(monkeypatch):
    monkeypatch.setattr(settings, "paseo_enabled", True)
    now = datetime(2026, 9, 3, 12, 0, tzinfo=UTC)
    host = ExecutionHost(
        label="Laptop",
        kind="paseo",
        target="laptop.local:6767",
        is_enabled=True,
    )

    host.last_seen_at = now - timedelta(minutes=1)
    assert execution_host_service.host_is_available(host, "/x", now=now) is True

    host.last_seen_at = now - timedelta(hours=2)
    assert execution_host_service.host_is_available(host, "/x", now=now) is False


def test_a_remote_host_is_tried_before_it_has_ever_been_probed(monkeypatch):
    monkeypatch.setattr(settings, "paseo_enabled", True)
    host = ExecutionHost(
        label="Laptop",
        kind="paseo",
        target="laptop.local:6767",
        is_enabled=True,
    )

    assert execution_host_service.host_is_available(host, "/x") is True


# --- resolution -----------------------------------------------------------


async def test_work_resolves_to_the_named_host_and_its_path(db_session, tmp_path):
    project = await _project(db_session)
    host = await _host(db_session)
    await _bind(db_session, project, host, str(tmp_path))

    resolution = await execution_host_service.resolve_workspace(db_session, project)

    assert resolution.host is not None and resolution.host.id == host.id
    assert resolution.path == str(tmp_path)
    assert resolution.is_available is True
    assert resolution.is_offline is False


# An offline machine is not a misconfiguration: the work is well defined and
# runs when that machine comes back, so it waits rather than failing.
async def test_an_unreachable_host_leaves_the_work_waiting(db_session, monkeypatch):
    monkeypatch.setattr(settings, "paseo_enabled", True)
    project = await _project(db_session)
    host = await _host(
        db_session,
        label="Laptop",
        kind="paseo",
        target="laptop.local:6767",
    )
    host.last_seen_at = datetime.now(UTC) - timedelta(hours=3)
    await _bind(db_session, project, host, "/Users/someone/papers")

    resolution = await execution_host_service.resolve_workspace(db_session, project)

    assert resolution.is_offline is True
    assert resolution.is_unconfigured is False


# Work never moves on its own: another machine holds different files.
async def test_an_unreachable_host_is_not_swapped_for_a_reachable_one(
    db_session,
    tmp_path,
    monkeypatch,
):
    monkeypatch.setattr(settings, "paseo_enabled", True)
    project = await _project(db_session)
    laptop = await _host(
        db_session,
        label="Laptop",
        kind="paseo",
        target="laptop.local:6767",
    )
    laptop.last_seen_at = datetime.now(UTC) - timedelta(hours=3)
    workstation = await _host(db_session, label="Workstation", kind="local")
    db_session.add(
        ProjectHostPath(
            project_id=project.id,
            host_id=workstation.id,
            path=str(tmp_path),
        )
    )
    await _bind(db_session, project, laptop, "/Users/someone/papers")

    resolution = await execution_host_service.resolve_workspace(db_session, project)

    assert resolution.host is not None and resolution.host.id == laptop.id
    assert resolution.is_offline is True


async def test_a_project_with_nowhere_to_run_is_unconfigured(db_session):
    project = await _project(db_session)

    resolution = await execution_host_service.resolve_workspace(db_session, project)

    assert resolution.is_unconfigured is True
    assert resolution.is_offline is False


# Projects configured before paths were per-machine still resolve: their path
# always meant the machine the server runs on.
async def test_a_legacy_path_resolves_against_the_local_host(db_session, tmp_path):
    project = await _project(db_session, execution_workspace_path=str(tmp_path))
    await execution_host_service.ensure_local_host(db_session)

    resolution = await execution_host_service.resolve_workspace(db_session, project)

    assert resolution.host is not None and resolution.host.kind == "local"
    assert resolution.path == str(tmp_path)
    assert resolution.is_available is True


async def test_deleting_a_host_releases_the_projects_pinned_to_it(db_session, tmp_path):
    project = await _project(db_session)
    host = await _host(db_session)
    await _bind(db_session, project, host, str(tmp_path))

    await execution_host_service.delete_host(db_session, host)
    await db_session.refresh(project)

    assert project.execution_host_id is None


def test_an_unknown_host_kind_is_rejected():
    with pytest.raises(ValueError, match="Invalid execution host kind"):
        ExecutionHost(label="Mystery", kind="carrier-pigeon")


# --- workers checking in --------------------------------------------------


async def test_a_worker_registers_once_and_checks_back_in(db_session):
    first = await execution_host_service.register_worker(
        db_session,
        label="MacBook",
        platform="darwin",
    )
    seen_first = first.last_seen_at

    second = await execution_host_service.register_worker(db_session, label="MacBook")

    # Reopening the app is the same machine checking back in, not a new one.
    assert second.id == first.id
    assert second.kind == "worker"
    assert second.platform == "darwin"
    assert second.last_seen_at >= seen_first


async def test_a_worker_keeps_its_identity_when_renamed(db_session):
    from uuid import UUID

    device_id = UUID("00000000-0000-0000-0000-000000000001")
    first = await execution_host_service.register_worker(
        db_session,
        label="My Linux machine",
        device_id=device_id,
        platform="linux",
    )

    renamed = await execution_host_service.register_worker(
        db_session,
        label="ubuntu-lab",
        device_id=device_id,
        platform="linux",
    )

    assert renamed.id == first.id
    assert renamed.label == "ubuntu-lab"
    assert renamed.device_id == str(device_id)


async def test_two_devices_cannot_share_one_worker_label(db_session):
    from uuid import UUID

    await execution_host_service.register_worker(
        db_session,
        label="My Linux machine",
        device_id=UUID("00000000-0000-0000-0000-000000000001"),
    )

    with pytest.raises(ValidationError, match="different machine"):
        await execution_host_service.register_worker(
            db_session,
            label="My Linux machine",
            device_id=UUID("00000000-0000-0000-0000-000000000002"),
        )
    with pytest.raises(ValidationError, match="needs a device id"):
        await execution_host_service.register_worker(
            db_session,
            label="My Linux machine",
        )


async def test_device_identity_adopts_a_legacy_worker(db_session):
    from uuid import UUID

    legacy = await execution_host_service.register_worker(
        db_session,
        label="MacBook",
    )
    device_id = UUID("00000000-0000-0000-0000-000000000003")

    adopted = await execution_host_service.register_worker(
        db_session,
        label="MacBook",
        device_id=device_id,
    )

    assert adopted.id == legacy.id
    assert adopted.device_id == str(device_id)


async def test_registering_over_another_kind_of_host_is_refused(db_session):
    await _host(db_session, label="Workstation", kind="local")

    with pytest.raises(ValidationError):
        await execution_host_service.register_worker(db_session, label="Workstation")


# A worker exists only while its app is running, so silence means the machine
# is asleep and the work waits for it.
def test_a_worker_that_stopped_checking_in_is_offline():
    now = datetime(2026, 9, 3, 12, 0, tzinfo=UTC)
    host = ExecutionHost(label="MacBook", kind="worker", is_enabled=True)

    host.last_seen_at = now - timedelta(minutes=1)
    assert execution_host_service.host_is_available(host, "/Users/me/papers", now=now) is True

    host.last_seen_at = now - timedelta(hours=1)
    assert execution_host_service.host_is_available(host, "/Users/me/papers", now=now) is False


def test_a_worker_that_never_checked_in_is_offline():
    host = ExecutionHost(label="MacBook", kind="worker", is_enabled=True)

    assert execution_host_service.host_is_available(host, "/Users/me/papers") is False


async def test_a_sleeping_worker_leaves_its_project_waiting(db_session):
    project = await _project(db_session)
    worker = await _host(db_session, label="MacBook", kind="worker")
    worker.last_seen_at = datetime.now(UTC) - timedelta(hours=2)
    await _bind(db_session, project, worker, "/Users/me/papers")

    resolution = await execution_host_service.resolve_workspace(db_session, project)

    assert resolution.is_offline is True
    assert resolution.is_unconfigured is False


# --- claiming work --------------------------------------------------------


async def _queued_run(db, project: Project, host: ExecutionHost, **overrides):
    from models.agent_run import AgentRun
    from models.agent_task import AgentTask

    task = AgentTask(task_type="code", agent_type="code", instruction="Do the thing")
    db.add(task)
    await db.flush()
    defaults = dict(
        agent_task_id=task.id,
        project_id=project.id,
        attempt=1,
        instruction_snapshot="Do the thing",
        provider="worker",
        execution_host_id=host.id,
        status="queued",
    )
    defaults.update(overrides)
    run = AgentRun(**defaults)
    db.add(run)
    await db.flush()
    return run


async def test_a_worker_claims_the_run_waiting_for_it(db_session, tmp_path):
    project = await _project(db_session)
    worker = await _host(db_session, label="MacBook", kind="worker")
    await _bind(db_session, project, worker, str(tmp_path))
    run = await _queued_run(db_session, project, worker)

    job = await execution_host_service.claim_next_job(db_session, worker)

    assert job is not None
    assert job.run_id == run.id
    assert job.cwd == str(tmp_path)
    assert job.instruction == "Do the thing"


# Two polls, or a worker restarted mid-poll, must not both pick up the run.
async def test_a_claimed_run_is_not_handed_out_twice(db_session, tmp_path):
    project = await _project(db_session)
    worker = await _host(db_session, label="MacBook", kind="worker")
    await _bind(db_session, project, worker, str(tmp_path))
    await _queued_run(db_session, project, worker)

    first = await execution_host_service.claim_next_job(db_session, worker)
    second = await execution_host_service.claim_next_job(db_session, worker)

    assert first is not None
    assert second is None


async def test_concurrent_sqlite_claims_hand_out_one_run_once(tmp_path):
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'concurrent-worker-claim.db'}",
        pool_size=2,
        max_overflow=0,
    )
    sessions = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with sessions() as seed_db:
            project = await _project(seed_db)
            worker = await _host(seed_db, label="MacBook", kind="worker")
            await _bind(seed_db, project, worker, str(tmp_path))
            run = await _queued_run(seed_db, project, worker)
            await seed_db.commit()
            worker_id = worker.id
            run_id = run.id

        async def claim():
            async with sessions() as db:
                host = await db.get(ExecutionHost, worker_id)
                assert host is not None
                job = await execution_host_service.claim_next_job(db, host)
                await db.commit()
                return job

        claims = await asyncio.gather(claim(), claim())

        assert sum(job is not None for job in claims) == 1
        assert {job.run_id for job in claims if job is not None} == {run_id}
    finally:
        await engine.dispose()


async def test_a_worker_is_not_handed_another_machines_work(db_session, tmp_path):
    project = await _project(db_session)
    worker = await _host(db_session, label="MacBook", kind="worker")
    other = await _host(db_session, label="Studio", kind="worker")
    await _bind(db_session, project, worker, str(tmp_path))
    await _queued_run(db_session, project, worker)

    assert await execution_host_service.claim_next_job(db_session, other) is None


# The path can be removed between queueing and the next poll.
async def test_a_run_whose_path_is_gone_fails_instead_of_being_handed_over(
    db_session,
    tmp_path,
):
    from models.agent_run import AgentRun

    project = await _project(db_session)
    worker = await _host(db_session, label="MacBook", kind="worker")
    await _bind(db_session, project, worker, str(tmp_path))
    run = await _queued_run(db_session, project, worker)
    await db_session.execute(
        ProjectHostPath.__table__.delete().where(
            ProjectHostPath.project_id == project.id
        )
    )

    job = await execution_host_service.claim_next_job(db_session, worker)

    assert job is None
    assert (await db_session.get(AgentRun, run.id)).status == "failed"
