from datetime import datetime

from config import settings
from fastapi import APIRouter, Depends, Path, Query, Request
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from database import get_db
from schemas.calendar import (
    CalendarSubscriptionSecret,
    CalendarSubscriptionStatus,
    EventCreate,
    EventResponse,
    EventUpdate,
)
from schemas.common import PaginatedResponse
from services.calendar import calendar_service, feed_token_service
from utils import deserialize_tags
from ws.notifications import notify_module_data_changed

router = APIRouter()

# Returned with every .ics body. A subscription URL is a credential, so no
# shared cache between the client and this server may keep a copy of the feed.
_ICS_HEADERS = {
    "Content-Disposition": 'attachment; filename="clawchat.ics"',
    "Cache-Control": "private, no-store",
}


def _event_to_response(row) -> EventResponse:
    """Convert an Event ORM object or virtual occurrence dict to EventResponse."""
    if isinstance(row, dict):
        # Virtual occurrence from recurrence expansion
        tags = row.get("tags")
        if isinstance(tags, str):
            tags = deserialize_tags(tags)
        return EventResponse(
            id=row["id"],
            project_id=row.get("project_id"),
            title=row["title"],
            description=row.get("description"),
            start_time=row["start_time"],
            end_time=row.get("end_time"),
            location=row.get("location"),
            is_all_day=row.get("is_all_day", False),
            reminder_minutes=row.get("reminder_minutes"),
            recurrence_rule=row.get("recurrence_rule"),
            recurrence_end=row.get("recurrence_end"),
            is_occurrence=row.get("is_occurrence", False),
            occurrence_date=row.get("occurrence_date"),
            recurring_event_id=row.get("recurring_event_id"),
            tags=tags if isinstance(tags, list) else None,
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )
    resp = EventResponse.model_validate(row)
    if row.tags:
        resp.tags = deserialize_tags(row.tags)
    return resp


@router.get("", response_model=PaginatedResponse[EventResponse])
async def list_events(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    start_after: datetime | None = None,
    start_before: datetime | None = None,
    project_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    rows, total = await calendar_service.get_events(
        db,
        start_after=start_after,
        start_before=start_before,
        project_id=project_id,
        page=page,
        limit=limit,
    )

    items = [_event_to_response(row) for row in rows]

    return PaginatedResponse(items=items, total=total, page=page, limit=limit)


@router.get("/export.ics")
async def export_ics(
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """Export all events as an iCalendar (.ics) file.

    The bearer-authenticated download, unchanged: this is what an in-app
    "export my calendar" button uses. External subscriptions cannot send the
    header and use ``/api/events/feed/{token}.ics`` instead.
    """
    ics_data = await calendar_service.export_events_ical(db)
    return Response(
        content=ics_data,
        media_type="text/calendar",
        headers=_ICS_HEADERS,
    )


# ---------------------------------------------------------------------------
# Calendar subscription
#
# These three routes are declared before ``/{event_id}`` so the literal path
# segments win over the event-id parameter.
#
# The management routes below are bearer-authenticated like everything else.
# Only ``read_feed`` accepts a feed token, and it is the single place in the
# application that calls ``resolve_feed_token``. A feed token is an opaque
# random string rather than a JWT, so it additionally cannot survive
# ``decode_token_any``; the isolation does not rest on route wiring alone.
# ---------------------------------------------------------------------------


def _feed_urls(request: Request, token: str) -> tuple[str, str]:
    """Build the subscribable URL pair for *token*.

    ``PUBLIC_URL`` wins when configured because that is the address reachable
    from outside the LAN, which is the whole point of a subscription. The
    request's own base URL is the fallback for a plain local install.
    """
    base = (settings.public_url or str(request.base_url)).rstrip("/")
    url = f"{base}/api/events/feed/{token}.ics"
    # webcal:// makes Apple Calendar and Outlook subscribe on click instead of
    # downloading a one-off snapshot.
    _, _, remainder = url.partition("://")
    return url, f"webcal://{remainder}"


def _status(row) -> CalendarSubscriptionStatus:
    if row is None:
        return CalendarSubscriptionStatus(active=False)
    return CalendarSubscriptionStatus(
        active=True,
        created_at=row.created_at,
        last_used_at=row.last_used_at,
    )


@router.get("/subscription", response_model=CalendarSubscriptionStatus)
async def get_subscription(
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """Report whether a subscription feed is live.

    The URL is deliberately absent: only a hash of the token is stored, so it
    cannot be reconstructed. Losing it means reissuing.
    """
    return _status(await feed_token_service.get_active_feed_token(db))


@router.post(
    "/subscription",
    response_model=CalendarSubscriptionSecret,
    status_code=201,
)
async def create_subscription(
    request: Request,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """Issue a subscription URL, invalidating any previous one immediately.

    This is the only response that ever contains the feed URL. Anyone who holds
    it can read every event in the calendar without logging in, so it should be
    treated like a password.
    """
    token, row = await feed_token_service.issue_feed_token(db)
    await db.commit()
    await db.refresh(row)

    url, webcal_url = _feed_urls(request, token)
    return CalendarSubscriptionSecret(
        active=True,
        created_at=row.created_at,
        last_used_at=row.last_used_at,
        url=url,
        webcal_url=webcal_url,
    )


@router.delete("/subscription", status_code=204)
async def delete_subscription(
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """Revoke the subscription URL. Subsequent fetches get 401."""
    await feed_token_service.revoke_feed_tokens(db)
    await db.commit()


@router.get("/feed/{token}.ics")
async def read_feed(
    token: str = Path(..., min_length=16, max_length=128),
    db: AsyncSession = Depends(get_db),
):
    """Serve the iCalendar feed to an unauthenticated subscriber.

    No bearer dependency: a calendar client cannot supply one. The path token
    is the entire credential and grants read access to this feed and nothing
    else. It is never written to a log, in full or in part.
    """
    await feed_token_service.resolve_feed_token(db, token)
    ics_data = await calendar_service.export_events_ical(db)
    await db.commit()
    return Response(
        content=ics_data,
        media_type="text/calendar",
        headers=_ICS_HEADERS,
    )


@router.post("", response_model=EventResponse, status_code=201)
async def create_event(
    body: EventCreate,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    event = await calendar_service.create_event(
        db,
        title=body.title,
        description=body.description,
        project_id=body.project_id,
        start_time=body.start_time,
        end_time=body.end_time,
        location=body.location,
        is_all_day=body.is_all_day,
        reminder_minutes=body.reminder_minutes,
        recurrence_rule=body.recurrence_rule,
        recurrence_end=body.recurrence_end,
        tags=body.tags,
    )
    await db.commit()
    await db.refresh(event)

    resp = EventResponse.model_validate(event)
    if event.tags:
        resp.tags = deserialize_tags(event.tags)
    await notify_module_data_changed("events")
    return resp


@router.get("/{event_id}", response_model=EventResponse)
async def get_event(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    event = await calendar_service.get_event(db, event_id)
    resp = EventResponse.model_validate(event)
    if event.tags:
        resp.tags = deserialize_tags(event.tags)
    return resp


@router.patch("/{event_id}", response_model=EventResponse)
async def update_event(
    event_id: str,
    body: EventUpdate,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    data = body.model_dump(exclude_unset=True)
    event = await calendar_service.update_event(db, event_id, **data)
    await db.commit()
    await db.refresh(event)

    resp = EventResponse.model_validate(event)
    if event.tags:
        resp.tags = deserialize_tags(event.tags)
    await notify_module_data_changed("events")
    return resp


@router.delete("/{event_id}", status_code=204)
async def delete_event(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    await calendar_service.delete_event(db, event_id)
    await db.commit()
    await notify_module_data_changed("events")


@router.delete("/{event_id}/occurrences/{date}", status_code=204)
async def delete_event_occurrence(
    event_id: str,
    date: str,
    mode: str = Query("this_only", pattern="^(this_only|this_and_future|all)$"),
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """Delete a specific occurrence of a recurring event.

    mode: this_only — exclude just this date
          this_and_future — end recurrence before this date
          all — delete entire series
    """
    await calendar_service.delete_event_occurrence(db, event_id, date, mode)
    await db.commit()
    await notify_module_data_changed("events")
