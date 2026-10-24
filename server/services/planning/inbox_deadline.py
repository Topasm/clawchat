"""Conservative deadline parsing, anchored to capture time, not refresh time.

One date expression in a title is a deadline: relative days, weekdays,
``2026-11-03``, ``11월 3일``, ``11/3``, ``Nov 3``, ``3일까지``, optionally with the
weekday repeated (``10월 30일 금요일``) and a clock time (``오후 2시``, ``14:30``,
``2pm``). A trailing ``까지``/``마감`` or a
leading ``by`` is part of the expression but no longer required. Two or more
dates may describe a range or a correction, so they are never guessed.
"""

import re
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone, tzinfo
from zoneinfo import ZoneInfo

from schemas.inbox_triage import InboxDeadlineSuggestion

_DAYS = ["월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "일요일"]
_EN_DAYS = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
]
_EN_MONTHS = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
]

_DAY = "|".join(_DAYS + _EN_DAYS)
_WEEK = r"이번\s*주|다음\s*주|this|next"
_MONTH_NAME = (
    r"(?P<mon>jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?"
    r"|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
)
_DATE = (
    rf"(?P<rel>오늘|내일|모레|today|tomorrow)"
    rf"|(?:(?P<week>{_WEEK})\s*)?(?P<wday>{_DAY})"
    r"|(?P<iy>\d{4})[-./](?P<im>\d{1,2})[-./](?P<id>\d{1,2})"
    r"|(?:(?P<ky>\d{4})\s*년\s*)?(?P<km>\d{1,2})\s*월\s*(?P<kd>\d{1,2})\s*일"
    r"|(?<![\d/.])(?P<sm>\d{1,2})/(?P<sd>\d{1,2})(?![\d/])"
    rf"|{_MONTH_NAME}\.?\s+(?P<md>\d{{1,2}})(?:st|nd|rd|th)?(?!\d)"
    # A bare day of the month is only a deadline when it says so: "3일 동안" is a span.
    r"|(?P<dd>\d{1,2})\s*일(?=\s*(?:까지|마감))"
)
_TIME = (
    r"(?:(?P<ampm>오전|오후|아침|새벽|저녁|밤)\s*)?(?P<hh>\d{1,2})\s*시(?!간)(?:\s*(?P<mm>\d{1,2})\s*분|\s*(?P<half>반))?"
    r"|(?P<ch>\d{1,2}):(?P<cm>\d{2})(?:\s*(?P<cap>am|pm))?"
    r"|(?P<eh>\d{1,2})\s*(?P<eap>am|pm)"
)
# "10월 30일 금요일" / "Oct 30 (Fri)": the weekday names the same day again.
_DAY_AFTER_DATE = rf"(?:,?\s*\(?(?:{_DAY}|[월화수목금토일]|mon|tue|wed|thu|fri|sat|sun)\)?(?!\w))?"
_PATTERN = re.compile(
    rf"(?<!\w)(?:by\s+)?(?:{_DATE}){_DAY_AFTER_DATE}(?:\s*(?:{_TIME}))?(?:\s*(?:까지|마감))?",
    re.IGNORECASE,
)
# "이번주" on its own qualifies a weekday elsewhere in the title.
_LONE_WEEK = re.compile(r"(?<!\w)(이번\s*주|다음\s*주)(?!\s*(?:" + _DAY + "))")
_EXCLUDED = re.compile(r"지난|다다음|매주|매일|매달|last\s|every\s", re.IGNORECASE)


Zone = str | tzinfo


def as_zone(zone: Zone) -> tzinfo:
    """An IANA name, or a zone already resolved (the server's own may have no name)."""
    return ZoneInfo(zone) if isinstance(zone, str) else zone


@dataclass(frozen=True)
class ParsedDeadline:
    local_date: date
    local_time: time | None
    source_text: str
    # The title with the date expression (and a lone week qualifier) removed.
    stripped_title: str


def _month_number(name: str) -> int:
    return _EN_MONTHS.index(name.lower()[:3]) + 1


def _upcoming(month: int, day: int, anchor: date) -> date:
    """A year-less date is the nearest one on or after the capture day."""
    candidate = date(anchor.year, month, day)
    return candidate if candidate >= anchor else date(anchor.year + 1, month, day)


def _resolve_date(match: re.Match[str], anchor: date, lone_week: str | None) -> date:
    if rel := match.group("rel"):
        offsets = {"오늘": 0, "today": 0, "내일": 1, "tomorrow": 1, "모레": 2}
        return anchor + timedelta(days=offsets[rel.lower()])
    if wday := match.group("wday"):
        week = re.sub(r"\s+", "", (match.group("week") or lone_week or "").lower())
        index = next(
            i for i, (ko, en) in enumerate(zip(_DAYS, _EN_DAYS, strict=True))
            if wday.lower() in (ko, en)
        )
        # Bare Friday also means this week's Friday, never silently rolls forward.
        weeks = 1 if week in ("다음주", "next") else 0
        return anchor + timedelta(days=index - anchor.weekday() + 7 * weeks)
    if match.group("iy"):
        return date(int(match.group("iy")), int(match.group("im")), int(match.group("id")))
    if match.group("km"):
        month, day = int(match.group("km")), int(match.group("kd"))
        if match.group("ky"):
            return date(int(match.group("ky")), month, day)
        return _upcoming(month, day, anchor)
    if match.group("sm"):
        return _upcoming(int(match.group("sm")), int(match.group("sd")), anchor)
    if match.group("mon"):
        return _upcoming(_month_number(match.group("mon")), int(match.group("md")), anchor)
    day = int(match.group("dd"))
    candidate = anchor.replace(day=day) if day >= anchor.day else None
    if candidate is None:
        month = anchor.month % 12 + 1
        candidate = date(anchor.year + (anchor.month == 12), month, day)
    return candidate


def _resolve_time(match: re.Match[str]) -> time | None:
    if match.group("hh"):
        hour = int(match.group("hh"))
        minute = int(match.group("mm") or (30 if match.group("half") else 0))
        if match.group("ampm") in ("오후", "저녁", "밤") and hour < 12:
            hour += 12
        elif match.group("ampm") in ("오전", "아침", "새벽") and hour == 12:
            hour = 0
        return time(hour, minute)
    if match.group("ch"):
        hour, minute = int(match.group("ch")), int(match.group("cm"))
        meridiem = (match.group("cap") or "").lower()
    elif match.group("eh"):
        hour, minute = int(match.group("eh")), 0
        meridiem = match.group("eap").lower()
    else:
        return None
    if meridiem == "pm" and hour < 12:
        hour += 12
    elif meridiem == "am" and hour == 12:
        hour = 0
    return time(hour, minute)


def _strip(title: str, spans: list[tuple[int, int]]) -> str:
    kept = []
    cursor = 0
    for start, end in sorted(spans):
        kept.append(title[cursor:start])
        cursor = end
    kept.append(title[cursor:])
    text = re.sub(r"\s+", " ", " ".join(part.strip() for part in kept)).strip()
    return text.strip(" ,·-") or title.strip()


def parse_deadline(title: str, anchor: date) -> ParsedDeadline | None:
    """The single deadline in *title*, resolved against the capture day *anchor*."""
    if _EXCLUDED.search(title):
        return None
    matches = list(_PATTERN.finditer(title))
    if len(matches) != 1:
        return None
    match = matches[0]
    lone = list(_LONE_WEEK.finditer(title))
    lone = [item for item in lone if not (match.start() <= item.start() < match.end())]
    if len(lone) > 1 or (lone and not match.group("wday")):
        return None
    lone_week = lone[0].group(1) if lone else None
    try:
        local_date = _resolve_date(match, anchor, lone_week)
        local_time = _resolve_time(match)
    except ValueError:
        return None
    spans = [match.span()] + [item.span() for item in lone]
    return ParsedDeadline(
        local_date=local_date,
        local_time=local_time,
        source_text=match.group(0).strip(),
        stripped_title=_strip(title, spans),
    )


def due_instant(parsed: ParsedDeadline, zone: Zone) -> datetime:
    """The deadline as a UTC instant: that clock time, or the end of that day.

    Due dates are UTC instants everywhere else (the date picker sends one, the
    Today window is computed in UTC against the client offset), and responses
    carry their zone, so the calendar day survives the trip.
    """
    clock = parsed.local_time or time(23, 59, 59)
    return datetime.combine(
        parsed.local_date, clock, tzinfo=as_zone(zone)
    ).astimezone(timezone.utc)


def capture_day(created_at: datetime, zone: Zone) -> date:
    captured = created_at.replace(tzinfo=created_at.tzinfo or timezone.utc)
    return captured.astimezone(as_zone(zone)).date()


def suggest_deadline(
    *,
    task_id: str,
    title: str,
    created_at: datetime,
    timezone_name: str,
    now: datetime | None = None,
) -> InboxDeadlineSuggestion | None:
    parsed = parse_deadline(title, capture_day(created_at, timezone_name))
    if parsed is None:
        return None
    due = due_instant(parsed, timezone_name)
    return InboxDeadlineSuggestion(
        task_id=task_id,
        due_date=due,
        local_date=parsed.local_date,
        timezone=timezone_name,
        source_text=parsed.source_text,
        is_past=due < (now or datetime.now(timezone.utc)),
    )
