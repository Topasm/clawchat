"""Conservative deadline-only parsing, anchored to capture time, not refresh time."""

import re
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from schemas.inbox_triage import InboxDeadlineSuggestion

_DAY = r"월요일|화요일|수요일|목요일|금요일|토요일|일요일|monday|tuesday|wednesday|thursday|friday|saturday|sunday"
_RELATIVE = r"오늘|내일|모레|today|tomorrow"
_DATE = rf"(?:(?:이번\s*주|다음\s*주|this|next)\s*)?(?:{_DAY})|{_RELATIVE}|\d{{4}}-\d{{2}}-\d{{2}}"
_PATTERN = re.compile(
    rf"(?:(?<!\w)by\s+(?P<en>{_DATE})(?!\w)|(?P<ko>{_DATE})\s*(?:까지|마감))",
    re.IGNORECASE,
)
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


def _resolve(expression: str, anchor: date) -> date:
    value = re.sub(r"\s+", "", expression.lower())
    offsets = {"오늘": 0, "today": 0, "내일": 1, "tomorrow": 1, "모레": 2}
    if value in offsets:
        return anchor + timedelta(days=offsets[value])
    for index, (ko, en) in enumerate(zip(_DAYS, _EN_DAYS, strict=True)):
        if value.endswith((ko, en)):
            # Bare Friday also means this week's Friday, never silently rolls forward.
            weeks = 1 if value.startswith(("다음주", "next")) else 0
            return anchor + timedelta(days=index - anchor.weekday() + 7 * weeks)
    return date.fromisoformat(value)


def suggest_deadline(
    *,
    task_id: str,
    title: str,
    created_at: datetime,
    timezone_name: str,
    now: datetime | None = None,
) -> InboxDeadlineSuggestion | None:
    if re.search(r"지난|다다음|매주|last\s|every\s", title, re.IGNORECASE):
        return None
    matches = list(_PATTERN.finditer(title))
    # Multiple dates may describe a range or a correction. Require manual editing.
    if len(matches) != 1:
        return None
    match = matches[0]
    zone = ZoneInfo(timezone_name)
    captured = created_at.replace(tzinfo=created_at.tzinfo or timezone.utc)
    try:
        local_date = _resolve(
            match.group("en") or match.group("ko"), captured.astimezone(zone).date()
        )
    except ValueError:
        return None
    # Existing task/calendar APIs represent date-only deadlines as local wall time.
    # SQLite drops DateTime offsets, so storing UTC here would move the visible
    # calendar day in negative-offset zones. Keep the local date, not an instant.
    due = datetime.combine(local_date, time(23, 59, 59))
    return InboxDeadlineSuggestion(
        task_id=task_id,
        due_date=due,
        local_date=local_date,
        timezone=timezone_name,
        source_text=match.group(0),
        is_past=due.replace(tzinfo=zone) < (now or datetime.now(timezone.utc)),
    )
