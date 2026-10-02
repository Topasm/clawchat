"""Clock times for the briefing and weekly review are read in the user's zone."""

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from services import scheduler


def test_daily_time_is_read_on_the_zone_wall_clock():
    seoul = ZoneInfo("Asia/Seoul")
    # 2026-10-01 22:30 UTC is 07:30 on 10-02 in Seoul: the 08:00 briefing is 30 min away.
    now = datetime(2026, 10, 1, 22, 30, tzinfo=timezone.utc)
    target = scheduler.next_daily_occurrence(now, "08:00", seoul)
    assert target.astimezone(timezone.utc) == datetime(2026, 10, 1, 23, 0, tzinfo=timezone.utc)
    # Once past, it is tomorrow's.
    later = datetime(2026, 10, 2, 0, 0, tzinfo=timezone.utc)  # 09:00 Seoul
    target = scheduler.next_daily_occurrence(later, "08:00", seoul)
    assert target.astimezone(timezone.utc) == datetime(2026, 10, 2, 23, 0, tzinfo=timezone.utc)


def test_weekly_time_lands_on_the_zone_weekday():
    seoul = ZoneInfo("Asia/Seoul")
    # Friday 2026-10-02 20:00 UTC is Saturday 05:00 in Seoul.
    now = datetime(2026, 10, 2, 20, 0, tzinfo=timezone.utc)
    target = scheduler.next_weekly_occurrence(now, 6, "09:00", seoul)  # Sunday
    assert target.weekday() == 6 and target.hour == 9 and target.tzinfo == seoul
    assert target.astimezone(timezone.utc) == datetime(2026, 10, 4, 0, 0, tzinfo=timezone.utc)


def test_schedule_zone_falls_back_to_local_on_bad_names(monkeypatch):
    monkeypatch.setattr(scheduler.settings, "schedule_timezone", "Not/AZone")
    assert scheduler.schedule_zone() is not None
    monkeypatch.setattr(scheduler.settings, "schedule_timezone", "Asia/Seoul")
    assert scheduler.schedule_zone() == ZoneInfo("Asia/Seoul")
