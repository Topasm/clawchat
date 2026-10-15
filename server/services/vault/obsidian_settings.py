"""Obsidian options the Settings page can change without a restart.

The project root folder defaults to ``OBSIDIAN_PROJECT_ROOT``; a value saved
from Settings lives in the user's settings row under ``"obsidian"`` and is
applied to ``settings`` at startup and on every save, so the indexer (which
runs in worker threads) reads one value.
"""

import json
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from models.user_settings import UserSettings
from utils.vault_paths import normalize_vault_relative_path
from ws.notifications import DEFAULT_USER_ID

logger = logging.getLogger(__name__)

SETTINGS_KEY = "obsidian"


def normalize_project_root(value: str) -> str:
    """Return the vault-relative form of *value*; raises ``VaultPathError``."""
    return normalize_vault_relative_path(value.strip(), allow_empty=True)


async def _row(db: AsyncSession, user_id: str) -> UserSettings | None:
    return (
        await db.execute(select(UserSettings).where(UserSettings.user_id == user_id))
    ).scalar_one_or_none()


def _stored(row: UserSettings | None) -> dict:
    if row is None:
        return {}
    try:
        stored = json.loads(row.settings_json or "{}")
    except ValueError:
        return {}
    return stored if isinstance(stored, dict) else {}


async def apply_saved_project_root(
    db: AsyncSession, user_id: str = DEFAULT_USER_ID
) -> None:
    """Apply a project root saved from Settings over the environment default."""
    section = _stored(await _row(db, user_id)).get(SETTINGS_KEY)
    if not isinstance(section, dict) or "project_root" not in section:
        return
    value = section["project_root"]
    if not isinstance(value, str):
        return
    try:
        settings.obsidian_project_root = normalize_project_root(value)
    except ValueError:
        logger.warning("Ignoring saved Obsidian project root %r", value)


async def save_project_root(
    db: AsyncSession, project_root: str, user_id: str = DEFAULT_USER_ID
) -> str:
    """Persist and apply *project_root* (already normalized)."""
    row = await _row(db, user_id)
    if row is None:
        row = UserSettings(user_id=user_id, settings_json="{}")
        db.add(row)
    stored = _stored(row)
    section = stored.get(SETTINGS_KEY)
    merged = dict(section) if isinstance(section, dict) else {}
    merged["project_root"] = project_root
    stored[SETTINGS_KEY] = merged
    row.settings_json = json.dumps(stored)
    await db.commit()
    settings.obsidian_project_root = project_root
    return project_root
