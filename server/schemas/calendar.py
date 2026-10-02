import json
from datetime import datetime

from pydantic import BaseModel, field_validator
from schemas._utc import UtcDatetime


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
    start_time: UtcDatetime
    end_time: UtcDatetime | None = None
    location: str | None = None
    is_all_day: bool
    reminder_minutes: int | None = None
    recurrence_rule: str | None = None
    recurrence_end: UtcDatetime | None = None
    is_occurrence: bool = False
    occurrence_date: str | None = None
    recurring_event_id: str | None = None
    tags: list[str] | None = None
    # "remote" events come from a connected calendar and are read-only here.
    origin: str = "local"
    calendar_source_id: str | None = None
    read_only: bool = False
    created_at: UtcDatetime
    updated_at: UtcDatetime

    model_config = {"from_attributes": True}

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
    created_at: UtcDatetime | None = None
    last_used_at: UtcDatetime | None = None


class CalendarSubscriptionSecret(CalendarSubscriptionStatus):
    """The issue/reissue response -- the only place the feed URL is returned.

    ``url`` embeds the feed token and is therefore a bearer credential in its
    own right: anyone holding it can read every event. It is shown once.
    """

    url: str
    webcal_url: str
