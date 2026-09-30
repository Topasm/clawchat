from datetime import datetime, timezone

from services.calendar.ical_import import master_fields, occurrences

NEW_YORK = """BEGIN:VTIMEZONE
TZID:America/New_York
BEGIN:STANDARD
DTSTART:20071104T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:20070311T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
END:DAYLIGHT
END:VTIMEZONE
"""

SERIES = f"""BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
{NEW_YORK}BEGIN:VEVENT
UID:weekly-1
DTSTAMP:20260901T000000Z
DTSTART;TZID=America/New_York:20261026T210000
DTEND;TZID=America/New_York:20261026T220000
RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261124T000000Z
EXDATE;TZID=America/New_York:20261109T210000
SUMMARY:Evening sync
END:VEVENT
BEGIN:VEVENT
UID:weekly-1
DTSTAMP:20260901T000000Z
RECURRENCE-ID;TZID=America/New_York:20261116T210000
DTSTART;TZID=America/New_York:20261116T230000
DTEND;TZID=America/New_York:20261116T233000
SUMMARY:Evening sync (moved)
END:VEVENT
BEGIN:VEVENT
UID:allday-1
DTSTAMP:20260901T000000Z
DTSTART;VALUE=DATE:20261030
DTEND;VALUE=DATE:20261031
SUMMARY:Holiday
END:VEVENT
BEGIN:VEVENT
UID:gone-1
DTSTAMP:20260901T000000Z
DTSTART:20261020T100000Z
DTEND:20261020T110000Z
STATUS:CANCELLED
SUMMARY:Cancelled
END:VEVENT
END:VCALENDAR
"""


def test_series_keep_local_time_across_dst_with_exdate_and_moves():
    found = occurrences(
        SERIES,
        datetime(2026, 10, 1, tzinfo=timezone.utc),
        datetime(2026, 12, 31, tzinfo=timezone.utc),
    )
    assert [(o.uid, o.title, o.start.isoformat(), o.is_all_day) for o in found] == [
        # 21:00 EDT, then 21:00 EST after the Nov 1 change: 01:00Z -> 02:00Z.
        ("weekly-1", "Evening sync", "2026-10-27T01:00:00+00:00", False),
        ("weekly-1", "Evening sync", "2026-11-03T02:00:00+00:00", False),
        # Nov 9 is excluded; Nov 16 moved to 23:00; Nov 23 is past UNTIL.
        ("weekly-1", "Evening sync (moved)", "2026-11-17T04:00:00+00:00", False),
        ("allday-1", "Holiday", "2026-10-30T00:00:00+00:00", True),
    ]
    assert found[0].end.isoformat() == "2026-10-27T02:00:00+00:00"
    assert found[2].recurrence_id == "2026-11-17T02:00:00+00:00"


def test_the_window_limits_what_is_returned():
    found = occurrences(
        SERIES,
        datetime(2026, 11, 2, tzinfo=timezone.utc),
        datetime(2026, 11, 4, tzinfo=timezone.utc),
    )
    assert [o.start.isoformat() for o in found] == ["2026-11-03T02:00:00+00:00"]


def test_master_fields_read_the_series_itself():
    fields = master_fields(SERIES, "weekly-1")
    assert (fields.title, fields.start.isoformat()) == ("Evening sync", "2026-10-27T01:00:00+00:00")
    assert master_fields(SERIES, "missing") is None
