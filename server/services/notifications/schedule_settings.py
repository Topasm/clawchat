"""When the daily briefing and the weekly review fire, and in whose zone.

The clock times live in the user's settings row (under ``"schedule"``) so the
Settings page can change them; whatever is not set there falls back to the
environment (``BRIEFING_TIME``, ``WEEKLY_REVIEW_DAY`` …). The scheduler loops
read the merged value before every sleep and are woken by ``notify_changed``
when a save lands, so a new time takes effect without a restart.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import asdict, dataclass, replace
from datetime import datetime, timedelta, timezone, tzinfo
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from models.user_settings import UserSettings
from ws.notifications import DEFAULT_USER_ID

logger = logging.getLogger(__name__)

SETTINGS_KEY = "schedule"
WEEKDAYS = (
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
)
_CLOCK = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


@dataclass(frozen=True)
class ScheduleSettings:
    briefing_enabled: bool
    briefing_time: str
    weekly_review_enabled: bool
    weekly_review_day: str
    weekly_review_time: str
    timezone: str
    """IANA zone name; empty means the server's local zone."""

    @property
    def zone(self) -> tzinfo:
        return resolve_zone(self.timezone)

    @property
    def effective_timezone(self) -> str:
        zone = self.zone
        key = getattr(zone, "key", None)
        if key:
            return str(key)
        name = datetime.now(zone).tzname()
        return name or "UTC"

    def next_briefing_at(self, now: datetime | None = None) -> datetime | None:
        if not self.briefing_enabled:
            return None
        current = now or datetime.now(timezone.utc)
        return next_daily_occurrence(current, self.briefing_time, self.zone).astimezone(
            timezone.utc
        )

    def next_weekly_review_at(self, now: datetime | None = None) -> datetime | None:
        if not self.weekly_review_enabled:
            return None
        current = now or datetime.now(timezone.utc)
        return next_weekly_occurrence(
            current,
            WEEKDAYS.index(self.weekly_review_day),
            self.weekly_review_time,
            self.zone,
        ).astimezone(timezone.utc)


def is_clock(value: str) -> bool:
    return bool(_CLOCK.match(value))


def is_zone(name: str) -> bool:
    """Whether ``name`` is an IANA zone (empty is allowed: the server's own)."""
    if not name:
        return True
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return False
    return True


def resolve_zone(name: str) -> tzinfo:
    """The zone ``name`` names, or the server's local zone when it is empty or unknown."""
    cleaned = (name or "").strip()
    if cleaned:
        try:
            return ZoneInfo(cleaned)
        except (ZoneInfoNotFoundError, ValueError):
            logger.warning(
                "Unknown schedule timezone %r; using the local zone", cleaned
            )
    local = datetime.now().astimezone().tzinfo
    return local if local is not None else timezone.utc


def _parse_clock(clock: str, default: tuple[int, int]) -> tuple[int, int]:
    match = _CLOCK.match(clock or "")
    if not match:
        return default
    return int(match.group(1)), int(match.group(2))


def next_daily_occurrence(now: datetime, clock: str, zone: tzinfo) -> datetime:
    """The next ``HH:MM`` on the wall clock of ``zone`` strictly after ``now``."""
    hour, minute = _parse_clock(clock, (9, 0))
    local_now = now.astimezone(zone)
    target = local_now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if target <= local_now:
        target = (local_now + timedelta(days=1)).replace(
            hour=hour, minute=minute, second=0, microsecond=0
        )
    return target


def next_weekly_occurrence(
    now: datetime, weekday: int, clock: str, zone: tzinfo
) -> datetime:
    """The next ``weekday`` (0 = Monday) at ``HH:MM`` in ``zone`` strictly after ``now``."""
    hour, minute = _parse_clock(clock, (9, 0))
    local_now = now.astimezone(zone)
    days_ahead = (weekday - local_now.weekday()) % 7
    target = (local_now + timedelta(days=days_ahead)).replace(
        hour=hour, minute=minute, second=0, microsecond=0
    )
    if target <= local_now:
        target = (target + timedelta(days=7)).replace(
            hour=hour, minute=minute, second=0, microsecond=0
        )
    return target


def defaults_from_env() -> ScheduleSettings:
    day = (settings.weekly_review_day or "sunday").strip().lower()
    return ScheduleSettings(
        briefing_enabled=True,
        briefing_time=settings.briefing_time
        if is_clock(settings.briefing_time)
        else "08:00",
        weekly_review_enabled=bool(settings.enable_weekly_review),
        weekly_review_day=day if day in WEEKDAYS else "sunday",
        weekly_review_time=(
            settings.weekly_review_time
            if is_clock(settings.weekly_review_time)
            else "09:00"
        ),
        timezone=(settings.schedule_timezone or "").strip(),
    )


def _merge(base: ScheduleSettings, stored: object) -> ScheduleSettings:
    """``base`` with every valid field of ``stored`` (a JSON object) applied."""
    if not isinstance(stored, dict):
        return base
    changes: dict[str, object] = {}
    for key in ("briefing_enabled", "weekly_review_enabled"):
        if isinstance(stored.get(key), bool):
            changes[key] = stored[key]
    for key in ("briefing_time", "weekly_review_time"):
        value = stored.get(key)
        if isinstance(value, str) and is_clock(value):
            changes[key] = value
    day = stored.get("weekly_review_day")
    if isinstance(day, str) and day.lower() in WEEKDAYS:
        changes["weekly_review_day"] = day.lower()
    zone = stored.get("timezone")
    if isinstance(zone, str) and is_zone(zone.strip()):
        changes["timezone"] = zone.strip()
    return replace(base, **changes)  # type: ignore[arg-type]


async def _row(db: AsyncSession, user_id: str) -> UserSettings | None:
    return (
        await db.execute(select(UserSettings).where(UserSettings.user_id == user_id))
    ).scalar_one_or_none()


async def load(db: AsyncSession, user_id: str = DEFAULT_USER_ID) -> ScheduleSettings:
    """The effective schedule: the environment defaults under the user's overrides."""
    base = defaults_from_env()
    row = await _row(db, user_id)
    if row is None:
        return base
    try:
        stored = json.loads(row.settings_json or "{}")
    except ValueError:
        return base
    return _merge(base, stored.get(SETTINGS_KEY))


async def save(
    db: AsyncSession, changes: dict[str, object], user_id: str = DEFAULT_USER_ID
) -> ScheduleSettings:
    """Store ``changes`` (already validated) under the user's ``"schedule"`` key."""
    row = await _row(db, user_id)
    if row is None:
        row = UserSettings(user_id=user_id, settings_json="{}")
        db.add(row)
    try:
        stored = json.loads(row.settings_json or "{}")
    except ValueError:
        stored = {}
    if not isinstance(stored, dict):
        stored = {}
    current = stored.get(SETTINGS_KEY)
    merged = dict(current) if isinstance(current, dict) else {}
    merged.update(changes)
    stored[SETTINGS_KEY] = merged
    row.settings_json = json.dumps(stored)
    await db.commit()
    notify_changed()
    return _merge(defaults_from_env(), merged)


def as_dict(value: ScheduleSettings) -> dict[str, object]:
    return asdict(value)


# --- change notification --------------------------------------------------
#
# Each scheduler loop subscribes with its own event, so one loop consuming a
# wake-up never swallows another loop's.

_listeners: set[asyncio.Event] = set()


def subscribe() -> asyncio.Event:
    event = asyncio.Event()
    _listeners.add(event)
    return event


def unsubscribe(event: asyncio.Event) -> None:
    _listeners.discard(event)


def notify_changed() -> None:
    for event in list(_listeners):
        event.set()


async def wait_for_change(event: asyncio.Event, timeout: float | None) -> bool:
    """Sleep until the schedule changes or ``timeout`` seconds pass.

    Returns True when woken by a change, False when the timeout elapsed, so the
    caller knows whether to fire or to recompute. The caller clears the event
    before it loads the settings, so a save that lands in between is not lost.
    """
    if timeout is not None and timeout <= 0:
        return event.is_set()
    try:
        await asyncio.wait_for(event.wait(), timeout)
    except TimeoutError:
        return False
    return True
