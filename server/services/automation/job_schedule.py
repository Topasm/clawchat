"""Recurrence for scheduled jobs, read as wall-clock times in the user's zone.

A job says "Mondays at 09:00" in its own time zone. Occurrences are computed
there, so they keep their local time across daylight-saving changes, and are
stored in UTC.
"""

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from dateutil.rrule import rrulestr

ALLOWED_FREQUENCIES = frozenset({"DAILY", "WEEKLY", "MONTHLY"})
# Every firing spends model time and lands in review; more often than hourly
# would flood the queue.
MIN_INTERVAL = timedelta(hours=1)
_INTERVAL_SAMPLES = 8


class ScheduleError(ValueError):
    """A schedule the server cannot or will not run."""


def parse_zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ScheduleError(f"Unknown time zone: {name}") from exc


def _rule(text: str, zone: ZoneInfo, anchor: datetime):
    body = text.strip()
    if body.upper().startswith("RRULE:"):
        body = body[len("RRULE:") :]
    parts = dict(
        part.split("=", 1) for part in body.upper().split(";") if "=" in part
    )
    if "DTSTART" in body.upper() or "\n" in body:
        raise ScheduleError("A schedule is a single RRULE without DTSTART")
    if parts.get("FREQ") not in ALLOWED_FREQUENCIES:
        raise ScheduleError("Schedules repeat daily, weekly, or monthly")
    # Anchoring at local midnight makes BYHOUR/BYMINUTE the only source of the
    # time of day, and keeps INTERVAL counted from a stable date.
    start = anchor.astimezone(zone).replace(hour=0, minute=0, second=0, microsecond=0)
    try:
        return rrulestr(body, dtstart=start)
    except (ValueError, TypeError) as exc:
        raise ScheduleError(f"Invalid schedule: {exc}") from exc


def validate(text: str, zone_name: str, *, anchor: datetime) -> None:
    """Reject rules that are malformed, never fire, or fire too often."""
    zone = parse_zone(zone_name)
    rule = _rule(text, zone, anchor)
    upcoming = []
    for occurrence in rule.xafter(datetime.now(zone), count=_INTERVAL_SAMPLES):
        upcoming.append(occurrence)
    if not upcoming:
        raise ScheduleError("This schedule has no upcoming runs")
    for earlier, later in zip(upcoming, upcoming[1:]):
        if later - earlier < MIN_INTERVAL:
            raise ScheduleError("Jobs can run at most once an hour")


def next_occurrence(
    text: str, zone_name: str, *, anchor: datetime, after: datetime
) -> datetime | None:
    """The first firing strictly after ``after``, in UTC, or None if none remain."""
    zone = parse_zone(zone_name)
    occurrence = _rule(text, zone, anchor).after(after.astimezone(zone))
    return occurrence.astimezone(timezone.utc) if occurrence else None
