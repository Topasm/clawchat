import json

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from database import get_db
from models.user_settings import UserSettings
from schemas.settings import (
    ScheduleSettingsResponse,
    ScheduleSettingsUpdate,
    SettingsPayload,
    SettingsResponse,
)
from services.notifications import schedule_settings

router = APIRouter(tags=["settings"])


@router.get("", response_model=SettingsResponse)
async def get_settings(
    db: AsyncSession = Depends(get_db),
    user: str = Depends(get_current_user),
):
    result = await db.execute(
        select(UserSettings).where(UserSettings.user_id == user)
    )
    row = result.scalar_one_or_none()

    if row is None:
        return SettingsResponse(settings={}, updated_at="")

    return SettingsResponse(
        settings=json.loads(row.settings_json),
        updated_at=row.updated_at.isoformat(),
    )


@router.put("", response_model=SettingsResponse)
async def save_settings(
    payload: SettingsPayload,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(get_current_user),
):
    result = await db.execute(
        select(UserSettings).where(UserSettings.user_id == user)
    )
    row = result.scalar_one_or_none()

    # Build the incoming dict (only non-None fields)
    incoming = payload.model_dump(exclude_none=True)

    if row is None:
        row = UserSettings(user_id=user, settings_json=json.dumps(incoming))
        db.add(row)
    else:
        existing = json.loads(row.settings_json)
        existing.update(incoming)
        row.settings_json = json.dumps(existing)

    await db.commit()
    await db.refresh(row)

    return SettingsResponse(
        settings=json.loads(row.settings_json),
        updated_at=row.updated_at.isoformat(),
    )


def _schedule_response(plan: schedule_settings.ScheduleSettings) -> ScheduleSettingsResponse:
    return ScheduleSettingsResponse(
        **schedule_settings.as_dict(plan),
        effective_timezone=plan.effective_timezone,
        next_briefing_at=plan.next_briefing_at(),
        next_weekly_review_at=plan.next_weekly_review_at(),
    )


@router.get("/schedule", response_model=ScheduleSettingsResponse)
async def get_schedule(
    db: AsyncSession = Depends(get_db),
    user: str = Depends(get_current_user),
):
    """The briefing and weekly review schedule in effect for this user."""
    return _schedule_response(await schedule_settings.load(db, user))


@router.put("/schedule", response_model=ScheduleSettingsResponse)
async def save_schedule(
    payload: ScheduleSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(get_current_user),
):
    """Change the schedule; the scheduler picks it up immediately."""
    changes = payload.model_dump(exclude_none=True)
    plan = await schedule_settings.save(db, changes, user)
    return _schedule_response(plan)
