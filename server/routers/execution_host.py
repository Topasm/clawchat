"""Registering the machines that run work, and where projects live on each."""

from auth.dependencies import get_current_user
from database import get_db
from exceptions import NotFoundError, ValidationError
from fastapi import APIRouter, Depends
from models.execution_host import ExecutionHost, ProjectHostPath
from schemas.execution_host import (
    ClaimedJobResponse,
    ExecutionHostCreate,
    ExecutionHostResponse,
    ExecutionHostUpdate,
    HostProjectPathResponse,
    WorkerRegistration,
)
from services.agents import execution_host_service
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter()


@router.get("", response_model=list[ExecutionHostResponse])
async def list_execution_hosts(
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    hosts = (
        (await db.execute(select(ExecutionHost).order_by(ExecutionHost.created_at.asc())))
        .scalars()
        .all()
    )
    return list(hosts)


@router.post("", response_model=ExecutionHostResponse, status_code=201)
async def create_execution_host(
    body: ExecutionHostCreate,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    if body.kind == "local" and await execution_host_service.get_local_host(db) is not None:
        raise ValidationError(
            "This server is already registered as a host.",
            details={"reason": "local_host_exists"},
        )
    if body.kind == "paseo" and not (body.target or "").strip():
        raise ValidationError(
            "A remote host needs a target to reach it.",
            details={"reason": "target_required"},
        )

    host = ExecutionHost(
        label=body.label.strip(),
        kind=body.kind,
        target=(body.target or "").strip() or None,
        platform=body.platform,
        is_enabled=body.is_enabled,
    )
    db.add(host)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise ValidationError(
            "Another host already uses that name.",
            details={"reason": "duplicate_label"},
        ) from exc
    await db.refresh(host)
    return host


@router.patch("/{host_id}", response_model=ExecutionHostResponse)
async def update_execution_host(
    host_id: str,
    body: ExecutionHostUpdate,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    host = await db.get(ExecutionHost, host_id)
    if host is None:
        raise NotFoundError("Execution host not found")

    updates = body.model_dump(exclude_unset=True)
    if "label" in updates and updates["label"]:
        host.label = updates["label"].strip()
    if "kind" in updates and updates["kind"]:
        host.kind = updates["kind"]
    if "target" in updates:
        host.target = (updates["target"] or "").strip() or None
    if "platform" in updates:
        host.platform = updates["platform"]
    if "is_enabled" in updates and updates["is_enabled"] is not None:
        host.is_enabled = updates["is_enabled"]

    if host.kind == "paseo" and not host.target:
        raise ValidationError(
            "A remote host needs a target to reach it.",
            details={"reason": "target_required"},
        )

    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise ValidationError(
            "Another host already uses that name.",
            details={"reason": "duplicate_label"},
        ) from exc
    await db.refresh(host)
    return host


@router.delete("/{host_id}", status_code=204)
async def delete_execution_host(
    host_id: str,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    host = await db.get(ExecutionHost, host_id)
    if host is None:
        raise NotFoundError("Execution host not found")

    # The paths recorded for this host go with it; the projects that pointed at
    # it are released rather than left waiting for a machine that is gone.
    await db.execute(
        ProjectHostPath.__table__.delete().where(ProjectHostPath.host_id == host.id)
    )
    await execution_host_service.delete_host(db, host)
    await db.commit()


@router.post("/register", response_model=ExecutionHostResponse)
async def register_worker_host(
    body: WorkerRegistration,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """Check a desktop app in as a machine that can run work.

    Called on launch and again on a timer. Registration is idempotent per
    label so reopening the app checks the same machine back in.
    """
    host = await execution_host_service.register_worker(
        db,
        label=body.label,
        device_id=body.device_id,
        platform=body.platform,
    )
    await db.commit()
    await db.refresh(host)
    return host


@router.post("/{host_id}/heartbeat", response_model=ExecutionHostResponse)
async def heartbeat(
    host_id: str,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """Keep a worker counted as reachable."""
    host = await db.get(ExecutionHost, host_id)
    if host is None:
        raise NotFoundError("Execution host not found")
    await execution_host_service.record_heartbeat(db, host)
    await db.commit()
    await db.refresh(host)
    return host


@router.get("/{host_id}/paths", response_model=list[HostProjectPathResponse])
async def list_host_project_paths(
    host_id: str,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """The project folders recorded on this machine, for its worker to look after."""
    host = await db.get(ExecutionHost, host_id)
    if host is None:
        raise NotFoundError("Execution host not found")
    rows = await execution_host_service.list_paths_for_host(db, host.id)
    return [
        HostProjectPathResponse(
            project_id=row.project_id,
            path=row.path,
            context_updated_at=row.context_updated_at,
        )
        for row in rows
    ]


@router.post("/{host_id}/jobs/claim", response_model=ClaimedJobResponse | None)
async def claim_next_job(
    host_id: str,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """Take the next run waiting for this machine, or nothing.

    Polled by the worker. Claiming also counts as checking in, so a machine
    asking for work is by definition reachable.
    """
    host = await db.get(ExecutionHost, host_id)
    if host is None:
        raise NotFoundError("Execution host not found")

    await execution_host_service.record_heartbeat(db, host)
    job = await execution_host_service.claim_next_job(db, host)
    await db.commit()
    return job
