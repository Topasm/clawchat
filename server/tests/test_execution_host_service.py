"""Choosing the machine a project's work runs on."""

from datetime import datetime, timedelta, timezone

import pytest

from config import settings
from exceptions import ValidationError
from models.execution_host import ExecutionHost, ProjectHostPath
from models.project import Project
from services.agents import execution_host_service

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
