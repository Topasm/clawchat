"""Whether the Inbox files captures by itself (on unless the user turned it off)."""

import json

from models.user_settings import UserSettings
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from ws.notifications import DEFAULT_USER_ID

SETTINGS_KEY = "inboxAutoOrganize"


async def auto_organize_enabled(
    db: AsyncSession, user_id: str = DEFAULT_USER_ID
) -> bool:
    raw = (
        await db.execute(
            select(UserSettings.settings_json).where(UserSettings.user_id == user_id)
        )
    ).scalar_one_or_none()
    try:
        stored = json.loads(raw or "{}")
    except ValueError:
        return True
    value = stored.get(SETTINGS_KEY) if isinstance(stored, dict) else None
    return value is not False
