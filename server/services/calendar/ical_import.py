"""Turn remote iCalendar objects into concrete occurrences.

A remote series is expanded here, in its own time zone, rather than stored as
a ClawChat recurrence rule: ClawChat expands rules in UTC, which would move
"every Monday 21:00 New York" onto Tuesdays. Overrides (RECURRENCE-ID),
EXDATE, RDATE, and cancelled occurrences are applied during expansion.
"""

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone

from dateutil.rrule import rruleset, rrulestr
from icalendar import Calendar

MAX_OCCURRENCES_PER_SERIES = 500


@dataclass(frozen=True)
class Occurrence:
    uid: str
    # None for a single event; the original start (UTC ISO or date) for a series.
    recurrence_id: str | None
    title: str
    description: str | None
    location: str | None
    start: datetime
    end: datetime | None
    is_all_day: bool
    last_modified: datetime | None


def _is_date(value) -> bool:
    return isinstance(value, date) and not isinstance(value, datetime)


def _as_datetime(value) -> datetime:
    """Dates become UTC midnight; floating times are read as UTC."""
    if _is_date(value):
        return datetime.combine(value, time.min, tzinfo=timezone.utc)
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _utc(value) -> datetime:
    return _as_datetime(value).astimezone(timezone.utc)


def _recurrence_key(value) -> str:
    return value.isoformat() if _is_date(value) else _utc(value).isoformat()


def _text(component, name: str) -> str | None:
    value = component.get(name)
    return str(value).strip() or None if value is not None else None


def _dt(component, name: str):
    prop = component.get(name)
    return prop.dt if prop is not None else None


def _duration(component, start) -> timedelta | None:
    end = _dt(component, "DTEND")
    if end is not None:
        return _as_datetime(end) - _as_datetime(start)
    duration = _dt(component, "DURATION")
    if isinstance(duration, timedelta):
        return duration
    return timedelta(days=1) if _is_date(start) else None


def _date_values(component, name: str) -> list:
    prop = component.get(name)
    if prop is None:
        return []
    props = prop if isinstance(prop, list) else [prop]
    return [item.dt for entry in props for item in getattr(entry, "dts", [])]


def _occurrence(component, uid: str, start, recurrence_id: str | None) -> Occurrence:
    duration = _duration(component, _dt(component, "DTSTART"))
    begins = _utc(start)
    modified = _dt(component, "LAST-MODIFIED") or _dt(component, "DTSTAMP")
    return Occurrence(
        uid=uid,
        recurrence_id=recurrence_id,
        title=_text(component, "SUMMARY") or "(untitled)",
        description=_text(component, "DESCRIPTION"),
        location=_text(component, "LOCATION"),
        start=begins,
        end=begins + duration if duration is not None else None,
        is_all_day=_is_date(start),
        last_modified=_utc(modified) if modified is not None else None,
    )


def _cancelled(component) -> bool:
    return (_text(component, "STATUS") or "").upper() == "CANCELLED"


def _expand_series(master, uid: str, window_start: datetime, window_end: datetime):
    start = _dt(master, "DTSTART")
    all_day = _is_date(start)
    anchor = datetime.combine(start, time.min) if all_day else start
    rules = rruleset()
    for prop in master.get("RRULE") and [master["RRULE"]] or []:
        text = prop.to_ical().decode()
        if all_day or anchor.tzinfo is None:
            # dateutil insists UNTIL is floating when DTSTART is.
            text = ";".join(
                part.rstrip("Z") if part.upper().startswith("UNTIL=") else part
                for part in text.split(";")
            )
        rules.rrule(rrulestr(text, dtstart=anchor))
    rules.rdate(anchor)
    for extra in _date_values(master, "RDATE"):
        rules.rdate(datetime.combine(extra, time.min) if _is_date(extra) else extra)
    for excluded in _date_values(master, "EXDATE"):
        if all_day:
            rules.exdate(datetime.combine(excluded, time.min if _is_date(excluded) else excluded.time()))
        elif _is_date(excluded):
            rules.exdate(datetime.combine(excluded, anchor.timetz()))
        else:
            rules.exdate(excluded.astimezone(anchor.tzinfo) if anchor.tzinfo else excluded)

    if all_day or anchor.tzinfo is None:
        lower = window_start.replace(tzinfo=None)
        upper = window_end.replace(tzinfo=None)
    else:
        lower, upper = window_start, window_end
    # Look back far enough that an occurrence already under way still shows.
    duration = _duration(master, start) or timedelta(0)
    count = 0
    for moment in rules.between(lower - duration, upper, inc=True):
        value = moment.date() if all_day else moment
        yield value
        count += 1
        if count >= MAX_OCCURRENCES_PER_SERIES:
            return


def occurrences(ics: str, window_start: datetime, window_end: datetime) -> list[Occurrence]:
    """Every occurrence in one iCalendar object that overlaps the window."""
    calendar = Calendar.from_ical(ics)
    masters: dict[str, object] = {}
    overrides: dict[str, dict[str, object]] = {}
    for component in calendar.walk("VEVENT"):
        uid = _text(component, "UID")
        if uid is None or _dt(component, "DTSTART") is None:
            continue
        recurrence = _dt(component, "RECURRENCE-ID")
        if recurrence is None:
            masters[uid] = component
        else:
            overrides.setdefault(uid, {})[_recurrence_key(recurrence)] = component

    result: list[Occurrence] = []

    def keep(item: Occurrence) -> None:
        end = item.end or item.start
        if item.start < window_end and end >= window_start:
            result.append(item)

    for uid, master in masters.items():
        changed = overrides.get(uid, {})
        if master.get("RRULE") is None and master.get("RDATE") is None:
            if not _cancelled(master):
                keep(_occurrence(master, uid, _dt(master, "DTSTART"), None))
            continue
        for value in _expand_series(master, uid, window_start, window_end):
            key = _recurrence_key(value)
            override = changed.pop(key, None)
            if override is not None:
                if not _cancelled(override):
                    keep(_occurrence(override, uid, _dt(override, "DTSTART"), key))
            elif not _cancelled(master):
                keep(_occurrence(master, uid, value, key))
        # Overrides moved into the window from an occurrence outside it.
        for key, override in changed.items():
            if not _cancelled(override):
                keep(_occurrence(override, uid, _dt(override, "DTSTART"), key))

    # Overrides whose master is not in this object (some servers split them).
    for uid, changed in overrides.items():
        if uid in masters:
            continue
        for key, override in changed.items():
            if not _cancelled(override):
                keep(_occurrence(override, uid, _dt(override, "DTSTART"), key))
    return result


def master_fields(ics: str, uid: str) -> Occurrence | None:
    """The series-level fields of ``uid`` in one object (its first occurrence)."""
    for component in Calendar.from_ical(ics).walk("VEVENT"):
        if (
            _text(component, "UID") == uid
            and component.get("RECURRENCE-ID") is None
            and _dt(component, "DTSTART") is not None
        ):
            return _occurrence(component, uid, _dt(component, "DTSTART"), None)
    return None
