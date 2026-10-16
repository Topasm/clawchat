from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx
import pytest
from sqlalchemy import select

from config import settings
from models.calendar_sync import CalendarAccount
from models.event import Event
from models.event_suggestion import EventSuggestion
from models.note import Note
from models.project import Project
from models.todo import Todo
from services.calendar import calendar_sync_service as sync
from services.calendar import event_suggestion_service as suggestions
from services.calendar import feed_url_secret

FEED = "https://calendar.google.com/calendar/ical/me%40gmail.com/private-0123456789abcdef/basic.ics"
SEOUL = ZoneInfo("Asia/Seoul")
NOW = datetime.now(timezone.utc).replace(second=0, microsecond=0)


def _stamp(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _vevent(uid: str, title: str, start: datetime, end: datetime, extra: str = "") -> str:
    return (
        f"BEGIN:VEVENT\r\nUID:{uid}\r\nDTSTAMP:{_stamp(NOW)}\r\n"
        f"DTSTART:{_stamp(start)}\r\nDTEND:{_stamp(end)}\r\nSUMMARY:{title}\r\n{extra}END:VEVENT\r\n"
    )


def _all_day(uid: str, title: str, day) -> str:
    return (
        f"BEGIN:VEVENT\r\nUID:{uid}\r\nDTSTAMP:{_stamp(NOW)}\r\n"
        f"DTSTART;VALUE=DATE:{day:%Y%m%d}\r\nDTEND;VALUE=DATE:{day + timedelta(days=1):%Y%m%d}\r\n"
        f"SUMMARY:{title}\r\nEND:VEVENT\r\n"
    )


def _calendar(*events: str, name: str = "Personal") -> str:
    return (
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Google Inc//Google Calendar 70.9054//EN\r\n"
        f"X-WR-CALNAME:{name}\r\n" + "".join(events) + "END:VCALENDAR\r\n"
    )


class FakeFeed:
    def __init__(self):
        self.body = _calendar()
        self.status = 200
        self.requests = 0

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests += 1
        if self.status != 200:
            return httpx.Response(self.status)
        return httpx.Response(200, text=self.body, headers={"Content-Type": "text/calendar"})


@pytest.fixture
def feed(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "calendar_key_file", str(tmp_path / "calendar.key"))
    server = FakeFeed()
    monkeypatch.setattr(sync, "feed_transport", httpx.MockTransport(server.handler))
    monkeypatch.setattr(sync, "wake_sync", lambda: None)
    return server


@pytest.fixture(autouse=True)
def quiet(monkeypatch):
    async def _silent(*_args, **_kwargs):
        return None

    monkeypatch.setattr(suggestions, "notify_module_data_changed", _silent)


async def _connect(db) -> CalendarAccount:
    return await sync.connect_feed(db, label="", url=FEED.replace("https://", "webcal://"))


async def _refresh(db, now: datetime = NOW) -> list[EventSuggestion]:
    await sync.sync_all(db)
    await suggestions.refresh(db, now)
    db.expire_all()
    return list((await db.execute(select(EventSuggestion))).scalars())


def _by_kind(rows: list[EventSuggestion]) -> dict[str, EventSuggestion]:
    return {row.kind: row for row in rows}


async def test_a_secret_ical_address_is_stored_encrypted_and_imported_read_only(db_session, feed):
    start = NOW + timedelta(days=3)
    feed.body = _calendar(_vevent("dinner-1", "Dinner", start, start + timedelta(hours=1)))
    account = await _connect(db_session)

    assert account.kind == "ics_url"
    assert account.label == "Personal"
    assert account.server_url == "https://calendar.google.com/…"
    assert "private-0123456789abcdef" not in (account.feed_url or "")
    assert feed_url_secret.reveal(account.feed_url) == FEED

    await sync.sync_all(db_session)
    event = (await db_session.execute(select(Event))).scalar_one()
    assert (event.title, event.origin) == ("Dinner", "remote")
    with pytest.raises(Exception):
        sync.ensure_editable(event)

    source = (await sync.sources_for(db_session, account.id))[0]
    with pytest.raises(Exception, match="only be read"):
        await sync.update_source(db_session, source.id, is_write_target=True)


async def test_a_broken_address_is_reported_without_repeating_it(db_session, feed):
    account_id = (await _connect(db_session)).id
    feed.status = 404
    await sync.sync_all(db_session)
    db_session.expire_all()
    account = await db_session.get(CalendarAccount, account_id)
    assert "no longer works" in account.last_error
    assert "private-" not in account.last_error


async def test_holiday_and_birthday_calendars_make_no_suggestions(db_session, feed):
    feed.body = _calendar(name="대한민국의 휴일")
    holidays = await sync.connect_feed(
        db_session,
        label="",
        url="https://calendar.google.com/calendar/ical/ko.south_korea%23holiday%40group.v.calendar.google.com/public/basic.ics",
    )
    source = (await sync.sources_for(db_session, holidays.id))[0]
    assert source.suggestions_enabled is False


async def test_an_exam_adds_its_study_task_the_day_before_and_can_be_undone(db_session, feed):
    exam = (NOW + timedelta(days=6)).astimezone(SEOUL).replace(hour=10, minute=0)
    feed.body = _calendar(
        _vevent("gpu-mid", "GPU 컴퓨팅 중간고사", exam, exam + timedelta(hours=2))
    )
    await _connect(db_session)
    rows = await _refresh(db_session)
    row = _by_kind(rows)["prepare_exam"]

    assert (row.status, row.auto_added, row.title) == ("accepted", True, "GPU 컴퓨팅 중간고사 준비")
    todo = await db_session.get(Todo, row.todo_id)
    assert todo.source == "calendar"
    assert todo.title == "GPU 컴퓨팅 중간고사 준비"
    # Due by the end of the day before, wherever the schedule's zone puts it.
    assert todo.due_date is not None and todo.due_date.replace(tzinfo=timezone.utc) < exam

    row_id, todo_id = row.id, row.todo_id
    visible = await suggestions.visible(db_session, NOW)
    assert [item.id for item in visible][:1] == [row_id]

    await suggestions.undo(db_session, row_id)
    db_session.expire_all()
    assert await db_session.get(Todo, todo_id) is None
    assert (await db_session.get(EventSuggestion, row_id)).status == "dismissed"


async def test_a_meeting_is_only_suggested_and_a_dismissal_sticks(db_session, feed):
    meeting = NOW + timedelta(days=4)
    feed.body = _calendar(_vevent("prof-1", "교수님 면담", meeting, meeting + timedelta(minutes=30)))
    await _connect(db_session)
    rows = await _refresh(db_session)
    row = _by_kind(rows)["prepare_meeting"]
    assert (row.status, row.title) == ("pending", "교수님 면담 전 진행 상황 정리")
    assert (await db_session.execute(select(Todo))).first() is None

    await suggestions.dismiss(db_session, row.id)
    rows = await _refresh(db_session)
    assert [(r.kind, r.status) for r in rows if r.kind == "prepare_meeting"] == [
        ("prepare_meeting", "dismissed")
    ]
    assert await suggestions.visible(db_session, NOW) == []


async def test_accepting_makes_one_task_and_repeated_syncs_add_nothing(db_session, feed):
    talk = NOW + timedelta(days=5)
    deadline = (NOW + timedelta(days=7)).date()
    feed.body = _calendar(
        _vevent("talk-1", "Lab seminar presentation", talk, talk + timedelta(hours=1)),
        _all_day("hw-3", "HW3 제출", deadline),
    )
    await _connect(db_session)
    rows = _by_kind(await _refresh(db_session))
    talk_row = rows["prepare_talk"]
    assert talk_row.title == "Prepare slides for Lab seminar presentation"
    assert rows["submit"].status == "accepted"

    accepted = await suggestions.accept(db_session, talk_row.id)
    assert accepted.status == "accepted"
    for _ in range(3):
        await _refresh(db_session)
    todos = list((await db_session.execute(select(Todo).where(Todo.source == "calendar"))).scalars())
    assert sorted(todo.title for todo in todos) == [
        "HW3 제출",
        "Prepare slides for Lab seminar presentation",
    ]
    task_rows = [
        row
        for row in (await db_session.execute(select(EventSuggestion))).scalars()
        if row.kind in suggestions.TASK_KINDS
    ]
    assert len(task_rows) == 2


async def test_auto_add_can_be_turned_off(db_session, feed):
    exam = NOW + timedelta(days=3)
    feed.body = _calendar(_vevent("quiz-1", "Quiz 2", exam, exam + timedelta(hours=1)))
    await _connect(db_session)
    await suggestions.set_auto_add(db_session, False)
    row = _by_kind(await _refresh(db_session))["prepare_exam"]
    assert (row.status, row.auto_added) == ("pending", False)


async def test_past_and_far_events_are_left_alone(db_session, feed):
    feed.body = _calendar(
        _vevent("old", "Final exam", NOW - timedelta(days=2), NOW - timedelta(days=2, hours=-2)),
        _vevent("far", "Final exam", NOW + timedelta(days=20), NOW + timedelta(days=20, hours=2)),
    )
    await _connect(db_session)
    assert [r for r in await _refresh(db_session) if r.kind != "time_block"] == []


async def test_a_finished_meeting_offers_a_note(db_session, feed):
    start = NOW - timedelta(hours=2)
    feed.body = _calendar(_vevent("weekly-1", "주간 회의", start, start + timedelta(hours=1)))
    await _connect(db_session)
    row = _by_kind(await _refresh(db_session))["meeting_notes"]
    assert row.title == "주간 회의 회의 내용"
    row_id = row.id
    await suggestions.accept(db_session, row_id)
    db_session.expire_all()
    note = await db_session.get(Note, (await db_session.get(EventSuggestion, row_id)).note_id)
    assert note.content.startswith("# 주간 회의 회의 내용")


async def test_a_weekly_class_is_offered_to_its_project(db_session, feed):
    project = Project(title="GPU_Computing")
    db_session.add(project)
    await db_session.commit()
    project_id = project.id
    start = NOW + timedelta(days=1)
    feed.body = _calendar(
        _vevent(
            "gpu-class",
            "GPU Computing",
            start,
            start + timedelta(hours=1, minutes=15),
            extra="RRULE:FREQ=WEEKLY;COUNT=10\r\n",
        )
    )
    await _connect(db_session)
    row = _by_kind(await _refresh(db_session))["link_project"]
    assert row.project_id == project_id
    await suggestions.accept(db_session, row.id)
    db_session.expire_all()
    linked = list(
        (await db_session.execute(select(Event.project_id).where(Event.external_uid == "gpu-class"))).scalars()
    )
    assert linked and set(linked) == {project_id}


async def test_a_task_with_a_deadline_is_offered_a_free_block(db_session, feed, monkeypatch):
    monkeypatch.setattr(settings, "schedule_timezone", "Asia/Seoul")
    await _connect(db_session)
    due = NOW + timedelta(days=5)
    todo = Todo(title="GPU 과제", due_date=due, estimated_minutes=120)
    db_session.add(todo)
    await db_session.commit()
    todo_id = todo.id
    row = _by_kind(await _refresh(db_session))["time_block"]
    row_id = row.id
    assert row.todo_id == todo_id
    assert row.block_end - row.block_start == timedelta(hours=2)
    begins = row.block_start.replace(tzinfo=timezone.utc)
    assert NOW < begins < due
    # Working hours on the schedule's wall clock, not UTC's.
    local = begins.astimezone(SEOUL)
    assert 9 <= local.hour and (local + timedelta(hours=2)).hour <= 17
    assert local.weekday() < 5

    await suggestions.accept(db_session, row_id)
    db_session.expire_all()
    event_id = (await db_session.get(EventSuggestion, row_id)).created_event_id
    block = await db_session.get(Event, event_id)
    assert (block.title, block.origin) == ("GPU 과제", "local")

    await suggestions.undo(db_session, row_id)
    db_session.expire_all()
    assert await db_session.get(Event, event_id) is None


async def test_nothing_is_suggested_without_a_connected_calendar(db_session):
    db_session.add(Todo(title="Report", due_date=NOW + timedelta(days=2)))
    await db_session.commit()
    assert await suggestions.refresh(db_session, NOW) is False


async def test_the_api_lists_and_answers_suggestions(client, auth_headers, feed, session_factory):
    meeting = NOW + timedelta(days=2)
    feed.body = _calendar(_vevent("m-1", "Lab meeting", meeting, meeting + timedelta(hours=1)))
    created = await client.post(
        "/api/calendar-sync/feeds", headers=auth_headers, json={"url": FEED}
    )
    assert created.status_code == 201, created.text
    assert "private-0123456789abcdef" not in created.text
    assert created.json()["kind"] == "ics_url"

    async with session_factory() as db:
        await sync.sync_all(db)
        await suggestions.refresh(db)

    listed = await client.get("/api/today/suggestions", headers=auth_headers)
    assert listed.status_code == 200, listed.text
    body = listed.json()
    assert body["auto_add"] is True
    item = next(s for s in body["suggestions"] if s["kind"] == "prepare_meeting")
    accepted = await client.post(
        f"/api/today/suggestions/{item['id']}/accept", headers=auth_headers
    )
    assert accepted.json()["status"] == "accepted"
    again = await client.post(f"/api/today/suggestions/{item['id']}/dismiss", headers=auth_headers)
    assert again.status_code == 409

    turned_off = await client.put(
        "/api/today/suggestions/settings", headers=auth_headers, json={"auto_add": False}
    )
    assert turned_off.json() == {"auto_add": False}
