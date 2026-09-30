from datetime import timezone

from auth.dependencies import get_current_user
from database import get_db
from fastapi import APIRouter, Depends, Response
from models.calendar_sync import CalendarAccount
from schemas.calendar_sync import (
    CalendarAccountCreate,
    CalendarAccountListResponse,
    CalendarAccountResponse,
    CalendarSourceResponse,
    CalendarSourceUpdate,
)
from services.calendar import calendar_sync_service as sync
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(dependencies=[Depends(get_current_user)])


def _utc(moment):
    return moment if moment is None or moment.tzinfo else moment.replace(tzinfo=timezone.utc)


async def _response(db: AsyncSession, account: CalendarAccount) -> CalendarAccountResponse:
    return CalendarAccountResponse(
        id=account.id,
        label=account.label,
        server_url=account.server_url,
        username=account.username,
        last_sync_at=_utc(account.last_sync_at),
        last_error=account.last_error,
        calendars=[
            CalendarSourceResponse(**sync.source_summary(source))
            for source in await sync.sources_for(db, account.id)
        ],
    )


@router.get("/accounts", response_model=CalendarAccountListResponse)
async def list_accounts(db: AsyncSession = Depends(get_db)):
    accounts = (
        await db.execute(select(CalendarAccount).order_by(CalendarAccount.created_at))
    ).scalars()
    return CalendarAccountListResponse(
        accounts=[await _response(db, account) for account in accounts]
    )


@router.post("/accounts", response_model=CalendarAccountResponse, status_code=201)
async def connect_account(body: CalendarAccountCreate, db: AsyncSession = Depends(get_db)):
    account = await sync.connect_account(
        db,
        label=body.label,
        server_url=body.server_url,
        username=body.username,
        password=body.password,
    )
    return await _response(db, account)


@router.delete("/accounts/{account_id}", status_code=204)
async def delete_account(account_id: str, db: AsyncSession = Depends(get_db)):
    await sync.delete_account(db, account_id)
    return Response(status_code=204)


@router.post("/accounts/{account_id}/sync", response_model=CalendarAccountResponse)
async def sync_now(account_id: str, db: AsyncSession = Depends(get_db)):
    account = await sync.require_account(db, account_id)
    await sync.sync_account(db, account)
    return await _response(db, await sync.require_account(db, account_id))


@router.patch("/calendars/{source_id}", response_model=CalendarSourceResponse)
async def update_calendar(
    source_id: str, body: CalendarSourceUpdate, db: AsyncSession = Depends(get_db)
):
    source = await sync.update_source(
        db,
        source_id,
        import_enabled=body.import_enabled,
        is_write_target=body.is_write_target,
    )
    return CalendarSourceResponse(**sync.source_summary(source))
