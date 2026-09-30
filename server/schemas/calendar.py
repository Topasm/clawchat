import json
from datetime import datetime, timezone

from pydantic import BaseModel, field_validator


class EventCreate(BaseModel):
    title: str
    project_id: str | None = None
    description: str | None = None
    start_time: datetime
    end_time: datetime | None = None
    location: str | None = None
    is_all_day: bool = False
    reminder_minutes: int | None = None
    recurrence_rule: str | None = None
    recurrence_end: datetime | None = None
    tags: list[str] | None = None


class EventUpdate(BaseModel):
    title: str | None = None
    project_id: str | None = None
    description: str | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    location: str | None = None
    is_all_day: bool | None = None
    reminder_minutes: int | None = None
    recurrence_rule: str | None = None
    recurrence_end: datetime | None = None
    tags: list[str] | None = None


class EventResponse(BaseModel):
    id: str
    project_id: str | None = None
    title: str
    description: str | None = None
    start_time: datetime
    end_time: datetime | None = None
    location: str | None = None
    is_all_day: bool
    reminder_minutes: int | None = None
    recurrence_rule: str | None = None
    recurrence_end: datetime | None = None
    is_occurrence: bool = False
    occurrence_date: str | None = None
    recurring_event_id: str | None = None
    tags: list[str] | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @field_validator(
        "start_time", "end_time", "recurrence_end", "created_at", "updated_at", mode="after"
    )
    @classmethod
    def _as_utc(cls, value: datetime | None) -> datetime | None:
        # SQLite returns the stored UTC values without a zone. Sent as is,
        # clients read them as local wall time and draw events hours off.
        if value is not None and value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value

    @field_validator("tags", mode="before")
    @classmethod
    def _parse_tags(cls, v: object) -> list[str] | None:
        if isinstance(v, str):
            return json.loads(v)
        return v  # type: ignore[return-value]


class CalendarSubscriptionStatus(BaseModel):
    """Metadata about the live subscription feed, without the secret.

    The token itself is unrecoverable after issue, so a read of this resource
    can only ever report *that* a feed exists, never how to fetch it.
    """

    active: bool
    created_at: datetime | None = None
    last_used_at: datetime | None = None


class CalendarSubscriptionSecret(CalendarSubscriptionStatus):
    """The issue/reissue response -- the only place the feed URL is returned.

    ``url`` embeds the feed token and is therefore a bearer credential in its
    own right: anyone holding it can read every event. It is shown once.
    """

    url: str
    webcal_url: str
