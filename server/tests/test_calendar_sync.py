import itertools
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit
from xml.sax.saxutils import escape

import httpx
import pytest
from sqlalchemy import select

from models.calendar_sync import CalendarAccount, CalendarPush, CalendarSource
from models.event import Event
from services.calendar import calendar_service, calendar_sync_service as sync
from services.calendar.caldav_client import CalDavClient

BASE = "https://dav.example.com"
NOW = datetime.now(timezone.utc).replace(microsecond=0)


def _stamp(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def vevent(uid, title, start, end, *, extra="", modified=None):
    return (
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//fake//EN\r\nBEGIN:VEVENT\r\n"
        f"UID:{uid}\r\nDTSTAMP:{_stamp(NOW)}\r\n"
        f"LAST-MODIFIED:{_stamp(modified or NOW)}\r\n"
        f"DTSTART:{_stamp(start)}\r\nDTEND:{_stamp(end)}\r\nSUMMARY:{title}\r\n{extra}"
        "END:VEVENT\r\nEND:VCALENDAR\r\n"
    )


class FakeCalDav:
    """An in-memory CalDAV server with a Work (events) and a Tasks (todos) calendar."""

    def __init__(self):
        self.objects: dict[str, dict[str, tuple[str, str]]] = {"work": {}, "tasks": {}}
        self.ctags = {"work": 1, "tasks": 1}
        self.etags = itertools.count(1)
        self.reports = 0
        self.requests: list[tuple[str, str, dict]] = []

    def add(self, calendar: str, name: str, ics: str) -> str:
        etag = f'"e{next(self.etags)}"'
        self.objects[calendar][name] = (ics, etag)
        self.ctags[calendar] += 1
        return etag

    def _multistatus(self, parts: list[str]) -> httpx.Response:
        body = (
            '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" '
            'xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" '
            'xmlns:a="http://apple.com/ns/ical/">' + "".join(parts) + "</d:multistatus>"
        )
        return httpx.Response(207, content=body.encode(), headers={"Content-Type": "application/xml"})

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = urlsplit(str(request.url)).path
        self.requests.append((request.method, path, dict(request.headers)))
        body = request.content.decode()
        if request.method == "PROPFIND" and path == "/":
            return self._multistatus([
                "<d:response><d:href>/</d:href><d:propstat><d:prop><d:current-user-principal>"
                "<d:href>/principals/me/</d:href></d:current-user-principal></d:prop></d:propstat></d:response>"
            ])
        if request.method == "PROPFIND" and path == "/principals/me/":
            return self._multistatus([
                "<d:response><d:href>/principals/me/</d:href><d:propstat><d:prop><c:calendar-home-set>"
                "<d:href>/calendars/me/</d:href></c:calendar-home-set></d:prop></d:propstat></d:response>"
            ])
        if request.method == "PROPFIND" and path == "/calendars/me/":
            return self._multistatus([
                "<d:response><d:href>/calendars/me/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>",
                "<d:response><d:href>/calendars/me/work/</d:href><d:propstat><d:prop>"
                "<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Work</d:displayname>"
                '<c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>'
                f"<cs:getctag>w{self.ctags['work']}</cs:getctag><a:calendar-color>#FF2968FF</a:calendar-color>"
                "</d:prop></d:propstat></d:response>",
                "<d:response><d:href>/calendars/me/tasks/</d:href><d:propstat><d:prop>"
                "<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Tasks</d:displayname>"
                '<c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>'
                "</d:prop></d:propstat></d:response>",
            ])
        calendar = path.split("/")[3] if path.startswith("/calendars/me/") else None
        if request.method == "PROPFIND" and calendar and "getctag" in body:
            return self._multistatus([
                f"<d:response><d:href>{path}</d:href><d:propstat><d:prop>"
                f"<cs:getctag>w{self.ctags[calendar]}</cs:getctag></d:prop></d:propstat></d:response>"
            ])
        if request.method == "REPORT" and calendar:
            self.reports += 1
            return self._multistatus([
                f"<d:response><d:href>/calendars/me/{calendar}/{name}</d:href><d:propstat><d:prop>"
                f"<d:getetag>{escape(etag)}</d:getetag><c:calendar-data>{escape(ics)}</c:calendar-data>"
                "</d:prop></d:propstat></d:response>"
                for name, (ics, etag) in self.objects[calendar].items()
            ])
        name = path.rsplit("/", 1)[-1]
        stored = self.objects.get(calendar or "", {}).get(name)
        if request.method == "GET":
            if stored is None:
                return httpx.Response(404)
            return httpx.Response(200, text=stored[0], headers={"ETag": stored[1]})
        if request.method == "PUT":
            if request.headers.get("If-None-Match") == "*" and stored is not None:
                return httpx.Response(412)
            if "If-Match" in request.headers and (stored is None or stored[1] != request.headers["If-Match"]):
                return httpx.Response(412)
            etag = self.add(calendar, name, body)
            return httpx.Response(201 if stored is None else 204, headers={"ETag": etag})
        if request.method == "DELETE":
            if stored is None:
                return httpx.Response(404)
            if "If-Match" in request.headers and stored[1] != request.headers["If-Match"]:
                return httpx.Response(412)
            del self.objects[calendar][name]
            self.ctags[calendar] += 1
            return httpx.Response(204)
        return httpx.Response(405)


@pytest.fixture
def dav(monkeypatch):
    server = FakeCalDav()
    transport = httpx.MockTransport(server.handler)
    monkeypatch.setattr(
        sync,
        "client_factory",
        lambda url, user, password: CalDavClient(url, user, password, transport=transport),
    )
    return server


async def _connect(db) -> tuple[CalendarAccount, CalendarSource]:
    account = await sync.connect_account(
        db, label="Work account", server_url=BASE, username="me", password="app-pass"
    )
    source = (await sync.sources_for(db, account.id))[0]
    return account, source


async def _connect_ids(db) -> tuple[str, str]:
    account, source = await _connect(db)
    return account.id, source.id


async def _sync(db) -> None:
    await sync.sync_all(db)
    db.expire_all()


async def test_connecting_finds_the_event_calendars(db_session, dav):
    account, source = await _connect(db_session)
    names = [s.display_name for s in await sync.sources_for(db_session, account.id)]
    assert names == ["Work"]  # the to-do-only calendar is left out
    assert (source.color, source.import_enabled, source.is_write_target) == ("#FF2968", True, False)
    assert account.home_url == f"{BASE}/calendars/me/"


async def test_imported_events_show_count_as_busy_and_stay_read_only(db_session, dav):
    start = (NOW + timedelta(days=2)).replace(hour=10, minute=0, second=0)
    dav.add("work", "standup.ics", vevent("standup", "Standup", start, start + timedelta(hours=1),
                                          extra="RRULE:FREQ=DAILY;COUNT=3\r\n"))
    await _connect(db_session)
    await _sync(db_session)

    rows = (await db_session.execute(select(Event).order_by(Event.start_time))).scalars().all()
    assert [(e.title, e.origin) for e in rows] == [("Standup", "remote")] * 3
    assert [e.start_time.replace(tzinfo=timezone.utc) for e in rows] == [
        start, start + timedelta(days=1), start + timedelta(days=2)
    ]
    from services.calendar import scheduling_service

    slots = await scheduling_service.find_free_slots(
        db_session,
        start.replace(hour=0),
        start.replace(hour=0) + timedelta(days=1),
        duration_minutes=60,
        working_hours=(0, 23),
    )
    windows = [
        (datetime.fromisoformat(slot["start"]), datetime.fromisoformat(slot["end"]))
        for slot in slots
    ]
    assert windows and all(not (a < start + timedelta(hours=1) and b > start) for a, b in windows)

    from exceptions import ConflictError

    with pytest.raises(ConflictError, match="connected calendar"):
        await calendar_service.update_event(db_session, rows[0].id, title="Mine now")
    with pytest.raises(ConflictError):
        await calendar_service.delete_event(db_session, rows[0].id)
    assert "Standup" not in await calendar_service.export_events_ical(db_session)


async def test_unchanged_calendars_are_not_read_again(db_session, dav):
    await _connect(db_session)
    await _sync(db_session)
    await _sync(db_session)
    assert dav.reports == 1
    dav.add("work", "new.ics", vevent("new", "New", NOW + timedelta(days=1), NOW + timedelta(days=1, hours=1)))
    await _sync(db_session)
    assert dav.reports == 2


async def test_events_removed_or_unchecked_disappear(db_session, dav):
    dav.add("work", "a.ics", vevent("a", "A", NOW + timedelta(days=1), NOW + timedelta(days=1, hours=1)))
    _account_id, source_id = await _connect_ids(db_session)
    await _sync(db_session)
    del dav.objects["work"]["a.ics"]
    dav.ctags["work"] += 1
    await _sync(db_session)
    assert (await db_session.execute(select(Event))).scalars().first() is None

    dav.add("work", "b.ics", vevent("b", "B", NOW + timedelta(days=1), NOW + timedelta(days=1, hours=1)))
    await _sync(db_session)
    await sync.update_source(db_session, source_id, import_enabled=False)
    assert (await db_session.execute(select(Event))).scalars().first() is None


async def test_clawchat_events_are_written_to_the_chosen_calendar(db_session, dav):
    _account_id, source_id = await _connect_ids(db_session)
    await sync.update_source(db_session, source_id, is_write_target=True)
    start = NOW + timedelta(days=3)
    event = await calendar_service.create_event(
        db_session, title="Dentist", start_time=start, end_time=start + timedelta(hours=1)
    )
    await db_session.commit()
    event_id = event.id

    await _sync(db_session)

    stored = dav.objects["work"][f"{event_id}.ics"]
    assert f"UID:{event_id}" in stored[0] and "SUMMARY:Dentist" in stored[0]
    create = next(r for r in dav.requests if r[0] == "PUT")
    assert create[2].get("if-none-match") == "*"
    event = await db_session.get(Event, event_id)
    assert (event.origin, event.external_etag, event.calendar_source_id) == ("local", stored[1], source_id)
    assert (await db_session.execute(select(CalendarPush))).scalars().first() is None
    # Reading the calendar back does not import ClawChat's own event twice.
    assert len((await db_session.execute(select(Event))).scalars().all()) == 1

    await calendar_service.update_event(db_session, event_id, title="Dentist (moved)")
    await db_session.commit()
    await _sync(db_session)
    assert "SUMMARY:Dentist (moved)" in dav.objects["work"][f"{event_id}.ics"][0]
    update = [r for r in dav.requests if r[0] == "PUT"][-1]
    assert update[2].get("if-match") == stored[1]

    await calendar_service.delete_event(db_session, event_id)
    await db_session.commit()
    await _sync(db_session)
    assert f"{event_id}.ics" not in dav.objects["work"]


async def test_edits_made_elsewhere_flow_back_and_later_changes_win(db_session, dav):
    _account_id, source_id = await _connect_ids(db_session)
    await sync.update_source(db_session, source_id, is_write_target=True)
    start = NOW + timedelta(days=5)
    event = await calendar_service.create_event(
        db_session, title="Review", start_time=start, end_time=start + timedelta(hours=1)
    )
    await db_session.commit()
    event_id = event.id
    await _sync(db_session)

    # Renamed in the phone's calendar app.
    later = datetime.now(timezone.utc) + timedelta(minutes=5)
    dav.add("work", f"{event_id}.ics",
            vevent(event_id, "Review with Kim", start, start + timedelta(hours=1), modified=later))
    await _sync(db_session)
    assert (await db_session.get(Event, event_id)).title == "Review with Kim"

    # A local edit queued before a newer remote edit loses to it.
    await calendar_service.update_event(db_session, event_id, title="Local rename")
    await db_session.commit()
    newest = datetime.now(timezone.utc) + timedelta(minutes=10)
    dav.add("work", f"{event_id}.ics",
            vevent(event_id, "Remote rename", start, start + timedelta(hours=1), modified=newest))
    await _sync(db_session)
    assert (await db_session.get(Event, event_id)).title == "Remote rename"
    assert "Remote rename" in dav.objects["work"][f"{event_id}.ics"][0]

    # Deleted in the other app: ClawChat's copy goes too.
    del dav.objects["work"][f"{event_id}.ics"]
    dav.ctags["work"] += 1
    await _sync(db_session)
    assert await db_session.get(Event, event_id) is None


async def test_disconnecting_keeps_clawchats_own_events(db_session, dav):
    account_id, source_id = await _connect_ids(db_session)
    await sync.update_source(db_session, source_id, is_write_target=True)
    event = await calendar_service.create_event(
        db_session, title="Keep me", start_time=NOW + timedelta(days=1)
    )
    dav.add("work", "theirs.ics", vevent("theirs", "Theirs", NOW + timedelta(days=1), NOW + timedelta(days=1, hours=1)))
    await db_session.commit()
    event_id = event.id
    await _sync(db_session)

    await sync.delete_account(db_session, account_id)
    db_session.expire_all()

    kept = await db_session.get(Event, event_id)
    assert kept is not None and kept.calendar_source_id is None and kept.external_href is None
    titles = [e.title for e in (await db_session.execute(select(Event))).scalars()]
    assert titles == ["Keep me"]


async def test_a_wrong_password_is_reported_not_raised(db_session, dav, monkeypatch):
    account, _source = await _connect(db_session)
    account_id = account.id

    def reject(request):
        return httpx.Response(401)

    monkeypatch.setattr(
        sync,
        "client_factory",
        lambda url, user, password: CalDavClient(url, user, password, transport=httpx.MockTransport(reject)),
    )
    await _sync(db_session)
    account = await db_session.get(CalendarAccount, account_id)
    assert "rejected the username or app password" in account.last_error


async def test_api_keeps_the_password_write_only(client, auth_headers, dav):
    created = await client.post(
        "/api/calendar-sync/accounts",
        headers=auth_headers,
        json={"label": "iCloud", "server_url": BASE, "username": "me", "password": "secret-pass"},
    )
    assert created.status_code == 201, created.text
    assert "secret-pass" not in created.text
    calendar = created.json()["calendars"][0]
    changed = await client.patch(
        f"/api/calendar-sync/calendars/{calendar['id']}",
        headers=auth_headers,
        json={"is_write_target": True},
    )
    assert changed.json()["is_write_target"] is True
    listed = await client.get("/api/calendar-sync/accounts", headers=auth_headers)
    assert listed.json()["accounts"][0]["calendars"][0]["is_write_target"] is True

