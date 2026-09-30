"""Two-sided CalDAV sync with a narrow contract.

- Calendars the user picks are imported: their events show in ClawChat and
  count as busy time. Imported events are read-only here.
- Events made in ClawChat are written to the one calendar the user picks, and
  edits or deletions made to them elsewhere flow back. When both sides changed
  the same event, the later change wins.
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from icalendar import Calendar

from exceptions import ConflictError, NotFoundError, ValidationError
from models.calendar_sync import CalendarAccount, CalendarPush, CalendarSource
from models.event import Event
from services.calendar import caldav_client
from services.calendar.caldav_client import CalDavClient, CalDavError, PreconditionFailed
from services.calendar.ical_import import Occurrence, master_fields, occurrences
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

WINDOW_PAST = timedelta(days=30)
WINDOW_FUTURE = timedelta(days=365)
# Unchanged calendars are still re-read this often, so recurring series keep
# extending as the window moves forward.
FULL_IMPORT_EVERY = timedelta(hours=24)
SYNC_INTERVAL_SECONDS = 15 * 60.0
PUSH_DEBOUNCE_SECONDS = 3.0
ORIGIN_LOCAL = "local"
ORIGIN_REMOTE = "remote"

client_factory = CalDavClient
_changed: asyncio.Event | None = None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _utc(moment: datetime | None) -> datetime | None:
    if moment is None:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


# --- Loop ---------------------------------------------------------------------


def watch_changes() -> asyncio.Event:
    global _changed
    _changed = asyncio.Event()
    return _changed


def wake_sync() -> None:
    if _changed is not None:
        _changed.set()


async def sync_loop(session_factory: Any) -> None:
    """Sync every account periodically and soon after a local change."""
    while True:
        watch = watch_changes()
        try:
            async with session_factory() as db:
                await sync_all(db)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Calendar sync pass failed")
        try:
            await asyncio.wait_for(watch.wait(), SYNC_INTERVAL_SECONDS)
            # Let a burst of edits settle into one push.
            await asyncio.sleep(PUSH_DEBOUNCE_SECONDS)
        except TimeoutError:
            pass


# --- Hooks from the calendar service -----------------------------------------------


def ensure_editable(event: Event) -> None:
    if event.origin == ORIGIN_REMOTE:
        raise ConflictError(
            "This event comes from a connected calendar. Change it in that calendar."
        )


async def write_target(db: AsyncSession) -> CalendarSource | None:
    return (
        await db.execute(select(CalendarSource).where(CalendarSource.is_write_target.is_(True)))
    ).scalar_one_or_none()


async def queue_push(db: AsyncSession, event: Event) -> None:
    """A ClawChat event changed; send it to its calendar on the next sync."""
    if event.origin != ORIGIN_LOCAL:
        return
    source_id = event.calendar_source_id
    if source_id is None:
        target = await write_target(db)
        source_id = target.id if target else None
    if source_id is None:
        return
    pending = (
        await db.execute(
            select(CalendarPush.id).where(
                CalendarPush.event_id == event.id, CalendarPush.action == "put"
            )
        )
    ).first()
    if pending is None:
        db.add(CalendarPush(source_id=source_id, event_id=event.id, action="put"))
    wake_sync()


async def queue_delete(db: AsyncSession, event: Event) -> None:
    """A ClawChat event is being deleted; remove it from its calendar too."""
    await db.execute(delete(CalendarPush).where(CalendarPush.event_id == event.id))
    if event.origin == ORIGIN_LOCAL and event.calendar_source_id and event.external_href:
        db.add(
            CalendarPush(
                source_id=event.calendar_source_id,
                action="delete",
                href=event.external_href,
                etag=event.external_etag,
            )
        )
        wake_sync()


# --- Accounts and calendars -----------------------------------------------------


async def connect_account(
    db: AsyncSession, *, label: str, server_url: str, username: str, password: str
) -> CalendarAccount:
    try:
        async with client_factory(server_url, username, password) as client:
            home = await client.discover_home()
            calendars = await client.list_calendars(home)
    except CalDavError as exc:
        raise ValidationError(str(exc)) from exc
    if not calendars:
        raise ValidationError("No event calendars were found in this account")
    account = CalendarAccount(
        label=label.strip() or caldav_client.normalize_server_url(server_url),
        server_url=caldav_client.normalize_server_url(server_url),
        username=username,
        password=password,
        home_url=home,
    )
    db.add(account)
    await db.flush()
    for calendar in calendars:
        db.add(
            CalendarSource(
                account_id=account.id,
                href=calendar.href,
                display_name=calendar.display_name,
                color=calendar.color,
                import_enabled=True,
            )
        )
    await db.commit()
    wake_sync()
    return account


async def require_account(db: AsyncSession, account_id: str) -> CalendarAccount:
    account = await db.get(CalendarAccount, account_id)
    if account is None:
        raise NotFoundError("Calendar account not found")
    return account


async def sources_for(db: AsyncSession, account_id: str) -> list[CalendarSource]:
    return list(
        (
            await db.execute(
                select(CalendarSource)
                .where(CalendarSource.account_id == account_id)
                .order_by(CalendarSource.display_name)
            )
        ).scalars()
    )


async def _detach_local_events(db: AsyncSession, source_ids: list[str]) -> None:
    """ClawChat's own events outlive the calendar they were copied to."""
    if not source_ids:
        return
    await db.execute(
        update(Event)
        .where(Event.origin == ORIGIN_LOCAL, Event.calendar_source_id.in_(source_ids))
        .values(calendar_source_id=None, external_href=None, external_etag=None)
    )


async def delete_account(db: AsyncSession, account_id: str) -> None:
    account = await require_account(db, account_id)
    source_ids = [source.id for source in await sources_for(db, account.id)]
    await _detach_local_events(db, source_ids)
    if source_ids:
        await db.execute(
            delete(Event).where(
                Event.origin == ORIGIN_REMOTE, Event.calendar_source_id.in_(source_ids)
            )
        )
    await db.delete(account)
    await db.commit()


async def update_source(
    db: AsyncSession,
    source_id: str,
    *,
    import_enabled: bool | None = None,
    is_write_target: bool | None = None,
) -> CalendarSource:
    source = await db.get(CalendarSource, source_id)
    if source is None:
        raise NotFoundError("Calendar not found")
    if import_enabled is not None:
        source.import_enabled = import_enabled
        if not import_enabled:
            await db.execute(
                delete(Event).where(
                    Event.calendar_source_id == source.id, Event.origin == ORIGIN_REMOTE
                )
            )
            source.ctag = None
    if is_write_target is not None:
        if is_write_target:
            await db.execute(
                update(CalendarSource)
                .where(CalendarSource.id != source.id)
                .values(is_write_target=False)
            )
            source.is_write_target = True
            await db.flush()
            # Copy the ClawChat events not yet in any calendar.
            unsynced = (
                await db.execute(
                    select(Event).where(
                        Event.origin == ORIGIN_LOCAL, Event.calendar_source_id.is_(None)
                    )
                )
            ).scalars()
            for event in unsynced:
                await queue_push(db, event)
        else:
            source.is_write_target = False
    await db.commit()
    wake_sync()
    return source


# --- Sync -------------------------------------------------------------------------


async def sync_all(db: AsyncSession) -> None:
    accounts = list((await db.execute(select(CalendarAccount))).scalars())
    for account in accounts:
        await sync_account(db, account)


async def sync_account(db: AsyncSession, account: CalendarAccount) -> None:
    account_id = account.id
    try:
        async with client_factory(account.server_url, account.username, account.password) as client:
            for source in await sources_for(db, account_id):
                await _push(db, client, source)
                if source.import_enabled or source.is_write_target:
                    await _import(db, client, source)
    except CalDavError as exc:
        await db.rollback()
        account = await db.get(CalendarAccount, account_id)
        if account is not None:
            account.last_error = str(exc)
            await db.commit()
        return
    account = await db.get(CalendarAccount, account_id)
    if account is not None:
        account.last_sync_at = _now()
        account.last_error = None
        await db.commit()


def _object_ics(event: Event, uid: str) -> str:
    from services.calendar.calendar_service import event_to_vevent

    calendar = Calendar()
    calendar.add("prodid", "-//ClawChat//EN")
    calendar.add("version", "2.0")
    calendar.add_component(event_to_vevent(event, uid=uid))
    return calendar.to_ical().decode("utf-8")


def _remote_modified(ics: str) -> datetime | None:
    for component in Calendar.from_ical(ics).walk("VEVENT"):
        stamp = component.get("LAST-MODIFIED") or component.get("DTSTAMP")
        if stamp is not None and component.get("RECURRENCE-ID") is None:
            return _utc(stamp.dt) if isinstance(stamp.dt, datetime) else None
    return None


async def _push(db: AsyncSession, client: CalDavClient, source: CalendarSource) -> None:
    pushes = list(
        (
            await db.execute(
                select(CalendarPush)
                .where(CalendarPush.source_id == source.id)
                .order_by(CalendarPush.created_at)
            )
        ).scalars()
    )
    for push in pushes:
        try:
            if push.action == "delete":
                if push.href:
                    try:
                        await client.delete(push.href, etag=push.etag)
                    except PreconditionFailed:
                        # Changed elsewhere after we last saw it; the later change wins.
                        remote = await client.get(push.href)
                        modified = _remote_modified(remote.ics) if remote else None
                        if remote is not None and (modified is None or modified <= _utc(push.created_at)):
                            await client.delete(push.href, etag=None)
                await db.delete(push)
            else:
                await _push_event(db, client, source, push)
            await db.commit()
        except CalDavError as exc:
            await db.rollback()
            failed = await db.get(CalendarPush, push.id)
            if failed is not None:
                failed.attempts += 1
                failed.last_error = str(exc)
                await db.commit()
            raise


async def _push_event(
    db: AsyncSession, client: CalDavClient, source: CalendarSource, push: CalendarPush
) -> None:
    event = await db.get(Event, push.event_id) if push.event_id else None
    if event is None or event.origin != ORIGIN_LOCAL:
        await db.delete(push)
        return
    uid = event.external_uid or event.id
    ics = _object_ics(event, uid)
    if event.external_href:
        try:
            etag = await client.put(event.external_href, ics, etag=event.external_etag, create=False)
        except PreconditionFailed:
            remote = await client.get(event.external_href)
            modified = _remote_modified(remote.ics) if remote else None
            if remote is not None and modified is not None and modified > _utc(push.created_at):
                _apply_master(event, remote.ics, uid)
                event.external_etag = remote.etag
                await db.delete(push)
                return
            etag = await client.put(event.external_href, ics, etag=None, create=remote is None)
    else:
        href = f"{source.href.rstrip('/')}/{uid}.ics"
        etag = await client.put(href, ics, etag=None, create=True)
        event.external_href = href
        event.calendar_source_id = source.id
    event.external_uid = uid
    event.external_etag = etag
    await db.delete(push)


def _apply_master(event: Event, ics: str, uid: str) -> None:
    """Take the other calendar's version of one of ClawChat's own events."""
    item = master_fields(ics, uid)
    if item is None:
        return
    event.title = item.title
    event.description = item.description
    event.location = item.location
    event.start_time = item.start
    event.end_time = item.end
    event.is_all_day = item.is_all_day


def _object_uids(ics: str) -> set[str]:
    try:
        return {str(c.get("UID")) for c in Calendar.from_ical(ics).walk("VEVENT") if c.get("UID")}
    except ValueError:
        return set()


async def _import(db: AsyncSession, client: CalDavClient, source: CalendarSource) -> None:
    now = _now()
    ctag = await client.ctag(source.href)
    fresh = source.last_synced_at and now - _utc(source.last_synced_at) < FULL_IMPORT_EVERY
    if ctag and ctag == source.ctag and fresh:
        return
    window_start, window_end = now - WINDOW_PAST, now + WINDOW_FUTURE
    objects = await client.events_between(source.href, window_start, window_end)

    # ClawChat's own events that live in this calendar.
    own = {
        event.external_uid: event
        for event in (
            await db.execute(
                select(Event).where(
                    Event.origin == ORIGIN_LOCAL, Event.calendar_source_id == source.id
                )
            )
        ).scalars()
        if event.external_uid
    }
    pending = {
        row
        for row in (
            await db.execute(select(CalendarPush.event_id).where(CalendarPush.event_id.isnot(None)))
        ).scalars()
    }
    seen_own: set[str] = set()
    wanted: dict[tuple[str, str | None], tuple[Occurrence, str, str | None]] = {}
    for obj in objects:
        uids = _object_uids(obj.ics)
        mine = uids & own.keys()
        if mine:
            for uid in mine:
                seen_own.add(uid)
                event = own[uid]
                if event.id not in pending and obj.etag and obj.etag != event.external_etag:
                    _apply_master(event, obj.ics, uid)
                    event.external_href = obj.href
                    event.external_etag = obj.etag
            continue
        if not source.import_enabled:
            continue
        try:
            items = occurrences(obj.ics, window_start, window_end)
        except (ValueError, TypeError):
            logger.warning("Skipping an unreadable event in %s", source.display_name)
            continue
        for item in items:
            wanted[(item.uid, item.recurrence_id)] = (item, obj.href, obj.etag)

    # Deleted in the other calendar: ClawChat's copy goes too, if it was in view.
    for uid, event in own.items():
        start = _utc(event.start_time)
        if uid not in seen_own and event.id not in pending and window_start <= start < window_end:
            await db.delete(event)

    existing = {
        (event.external_uid, event.external_recurrence_id): event
        for event in (
            await db.execute(
                select(Event).where(
                    Event.calendar_source_id == source.id, Event.origin == ORIGIN_REMOTE
                )
            )
        ).scalars()
    }
    for key, (item, href, etag) in wanted.items():
        event = existing.pop(key, None)
        if event is None:
            event = Event(
                origin=ORIGIN_REMOTE,
                calendar_source_id=source.id,
                external_uid=item.uid,
                external_recurrence_id=item.recurrence_id,
                title=item.title,
                start_time=item.start,
            )
            db.add(event)
        changes = {
            "title": item.title,
            "description": item.description,
            "location": item.location,
            "start_time": item.start,
            "end_time": item.end,
            "is_all_day": item.is_all_day,
            "external_href": href,
            "external_etag": etag,
        }
        for name, value in changes.items():
            current = getattr(event, name)
            if isinstance(current, datetime) and isinstance(value, datetime):
                if _utc(current) == value:
                    continue
            elif current == value:
                continue
            setattr(event, name, value)
    for event in existing.values():
        await db.delete(event)

    source.ctag = ctag
    source.last_synced_at = now
    await db.commit()


def source_summary(source: CalendarSource) -> dict:
    return {
        "id": source.id,
        "display_name": source.display_name,
        "color": source.color,
        "import_enabled": source.import_enabled,
        "is_write_target": source.is_write_target,
        "last_synced_at": _utc(source.last_synced_at),
    }

