from datetime import datetime, timedelta, timezone

from models.event import Event
from services.calendar import calendar_service


async def test_written_times_are_utc_not_floating(db_session):
    start = datetime(2026, 10, 3, 5, 0, tzinfo=timezone.utc)
    event = await calendar_service.create_event(
        db_session, title="Dentist", start_time=start, end_time=start + timedelta(hours=1)
    )
    await db_session.commit()
    event_id = event.id
    db_session.expire_all()
    # Read back the way SQLite returns it: without a time zone.
    event = await db_session.get(Event, event_id)
    assert event.start_time.tzinfo is None
    feed = await calendar_service.export_events_ical(db_session)
    assert "DTSTART:20261003T050000Z" in feed
    assert "DTEND:20261003T060000Z" in feed


async def test_event_times_leave_the_api_as_utc(client, auth_headers):
    created = await client.post(
        "/api/events",
        headers=auth_headers,
        json={"title": "Dentist", "start_time": "2026-10-03T05:00:00Z"},
    )
    assert created.status_code in (200, 201), created.text
    listed = await client.get("/api/events", headers=auth_headers)
    item = next(e for e in listed.json()["items"] if e["title"] == "Dentist")
    # A browser reads a zone-less time as local time; it must say UTC.
    assert item["start_time"] in ("2026-10-03T05:00:00Z", "2026-10-03T05:00:00+00:00")
