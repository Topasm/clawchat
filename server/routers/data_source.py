"""Folders a device offers for reading, and requests relayed to them."""

from auth.dependencies import AuthPrincipal, get_current_principal, get_current_user
from database import get_db
from exceptions import NotFoundError, ValidationError
from fastapi import APIRouter, Depends, Query
from models.data_source import DataSource, DataSourceEntry, DataSourceQuery
from models.paired_device import PairedDevice
from schemas.data_source import (
    DataSourceIndexUpdate,
    DataSourceQueryLog,
    DataSourceQueryRequest,
    DataSourceQueryResponse,
    DataSourceRegister,
    DataSourceResponse,
    DataSourceUpdate,
)
from services.agents import execution_host_service
from services.data_sources import service
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter()


async def _get_source(db: AsyncSession, source_id: str) -> DataSource:
    source = await db.get(DataSource, source_id)
    if source is None:
        raise NotFoundError("Data source not found")
    return source


@router.get("", response_model=list[DataSourceResponse])
async def list_data_sources(
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    sources = (
        (await db.execute(select(DataSource).order_by(DataSource.created_at.asc())))
        .scalars()
        .all()
    )
    return [await service.describe(db, source) for source in sources]


@router.post("", response_model=DataSourceResponse)
async def register_data_source(
    body: DataSourceRegister,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """Offer a folder on the calling machine for reading.

    Idempotent per machine and name, so the desktop app can repeat it on every
    launch. The folder's location on the machine is never sent.
    """
    host = await execution_host_service.register_worker(
        db,
        label=body.host_label,
        device_id=body.device_id,
        platform=body.platform,
        mark_seen=False,
    )
    name = body.name.strip()
    source = (
        await db.execute(
            select(DataSource).where(DataSource.host_id == host.id, DataSource.name == name)
        )
    ).scalar_one_or_none()
    if source is None:
        source = DataSource(host_id=host.id, kind=body.kind, name=name)
        db.add(source)
    elif source.kind != body.kind:
        raise ValidationError(
            "This machine already offers a different kind of source by that name.",
            details={"reason": "kind_conflict"},
        )
    service.apply_settings(
        source,
        capabilities=list(body.capabilities),
        include_folders=body.include_folders,
        exclude_folders=body.exclude_folders,
    )
    await db.commit()
    await db.refresh(source)
    return await service.describe(db, source)


@router.get("/{source_id}", response_model=DataSourceResponse)
async def get_data_source(
    source_id: str,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    return await service.describe(db, await _get_source(db, source_id))


@router.patch("/{source_id}", response_model=DataSourceResponse)
async def update_data_source(
    source_id: str,
    body: DataSourceUpdate,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    source = await _get_source(db, source_id)
    if body.name is not None:
        source.name = body.name.strip()
    service.apply_settings(
        source,
        capabilities=list(body.capabilities) if body.capabilities is not None else None,
        include_folders=body.include_folders,
        exclude_folders=body.exclude_folders,
    )
    if body.include_folders is not None or body.exclude_folders is not None:
        # The index was filtered by the old rules; it must not keep names
        # from a folder that has just been held back.
        policy = service.policy_for(source)
        rows = (
            await db.execute(select(DataSourceEntry).where(DataSourceEntry.source_id == source.id))
        ).scalars()
        for row in rows:
            if not policy.shows_entry(row.path, is_dir=False):
                await db.delete(row)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise ValidationError(
            "This machine already offers a source by that name.",
            details={"reason": "duplicate_name"},
        ) from exc
    await db.refresh(source)
    return await service.describe(db, source)


@router.delete("/{source_id}", status_code=204)
async def delete_data_source(
    source_id: str,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """Stop offering the source. Its index and request log go with it."""
    source = await _get_source(db, source_id)
    await db.delete(source)
    await db.commit()


@router.post("/{source_id}/query", response_model=DataSourceQueryResponse)
async def query_data_source(
    source_id: str,
    body: DataSourceQueryRequest,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    """List, read or search the source on the machine that holds it.

    Waits for that machine to answer. When it is off or slow, a listing or
    search comes from the light index (``origin: cache``); a read cannot,
    and fails with ``DATA_SOURCE_OFFLINE`` or ``DATA_SOURCE_TIMEOUT``.
    """
    source = await _get_source(db, source_id)
    return await service.query_source(
        db,
        source,
        op=body.op,
        raw_path=body.path,
        text=body.query,
        requested_by=principal.subject,
    )


@router.put("/{source_id}/index", status_code=204)
async def replace_data_source_index(
    source_id: str,
    body: DataSourceIndexUpdate,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """Replace the light index: file paths, titles and dates, never contents."""
    source = await _get_source(db, source_id)
    await service.replace_index(db, source, body.files)
    await db.commit()


@router.get("/{source_id}/queries", response_model=list[DataSourceQueryLog])
async def list_data_source_queries(
    source_id: str,
    limit: int = Query(default=50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """Who asked to read what, newest first, refusals included."""
    await _get_source(db, source_id)
    rows = (
        await db.execute(
            select(DataSourceQuery, PairedDevice.name)
            .outerjoin(PairedDevice, PairedDevice.id == DataSourceQuery.requested_by)
            .where(DataSourceQuery.source_id == source_id)
            .order_by(DataSourceQuery.created_at.desc())
            .limit(limit)
        )
    ).all()
    return [
        DataSourceQueryLog(
            id=row.id,
            op=row.op,
            path=row.path,
            query=row.query,
            status=row.status,
            error=row.error,
            requested_by=row.requested_by,
            requester_name=device_name,
            result_bytes=row.result_bytes,
            created_at=row.created_at,
            completed_at=row.completed_at,
        )
        for row, device_name in rows
    ]
