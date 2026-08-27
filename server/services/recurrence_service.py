"""Recurrence service — RRULE parsing and occurrence expansion."""

import json
from datetime import datetime, timedelta, timezone

from dateutil.rrule import rrulestr


def _match_timezone(value: datetime, reference: datetime) -> datetime:
    if reference.tzinfo is None:
        return value.replace(tzinfo=None)
    if value.tzinfo is None:
        return value.replace(tzinfo=reference.tzinfo)
    return value.astimezone(reference.tzinfo)


def parse_rrule(rule_string: str, dtstart: datetime, range_start: datetime, range_end: datetime) -> list[datetime]:
    """Parse an RRULE string and return occurrence datetimes within the given range."""
    try:
        rule = rrulestr(rule_string, dtstart=dtstart)
        return list(rule.between(range_start, range_end, inc=True))
    except (ValueError, TypeError):
        return []


def generate_occurrences(event, range_start: datetime, range_end: datetime) -> list[dict]:
    """Expand a recurring event into virtual occurrence dicts within the range.

    Each returned dict has the same shape as EventResponse fields plus
    `is_occurrence=True` and `occurrence_date` (ISO date string).
    """
    if not event.recurrence_rule:
        return []

    # Parse exception dates
    exceptions: set[str] = set()
    if event.recurrence_exceptions:
        try:
            exceptions = set(json.loads(event.recurrence_exceptions))
        except (json.JSONDecodeError, TypeError):
            pass

    # SQLite may return naive datetimes even for timezone-aware columns. Match
    # the query range to the series timezone before dateutil comparisons.
    series_start = event.start_time
    aligned_start = _match_timezone(range_start, series_start)
    effective_end = _match_timezone(range_end, series_start)
    recurrence_end = (
        _match_timezone(event.recurrence_end, series_start)
        if event.recurrence_end
        else None
    )
    if recurrence_end and recurrence_end < effective_end:
        effective_end = recurrence_end

    dates = parse_rrule(event.recurrence_rule, series_start, aligned_start, effective_end)

    # Compute event duration for end_time calculation
    duration = timedelta(0)
    if event.end_time:
        duration = event.end_time - event.start_time

    occurrences = []
    for dt in dates:
        date_key = dt.date().isoformat()
        if date_key in exceptions:
            continue

        # Skip the original event date — it's already returned as the base event
        if dt == event.start_time:
            continue

        occ = {
            "id": event.id,
            "title": event.title,
            "description": event.description,
            "start_time": dt,
            "end_time": dt + duration if duration else None,
            "location": event.location,
            "is_all_day": event.is_all_day,
            "reminder_minutes": event.reminder_minutes,
            "recurrence_rule": event.recurrence_rule,
            "recurrence_end": event.recurrence_end,
            "is_occurrence": True,
            "occurrence_date": date_key,
            "recurring_event_id": event.id,
            "tags": event.tags,
            "created_at": event.created_at,
            "updated_at": event.updated_at,
        }
        occurrences.append(occ)

    return occurrences
