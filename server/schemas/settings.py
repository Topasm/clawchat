from pydantic import BaseModel, Field, field_validator

from schemas._utc import UtcDatetime
from services.notifications.schedule_settings import WEEKDAYS, is_clock, is_zone


class SettingsPayload(BaseModel):
    # All fields optional so partial updates work
    fontSize: int | None = None
    messageBubbleStyle: str | None = None
    sendOnEnter: bool | None = None
    showTimestamps: bool | None = None
    showAvatars: bool | None = None
    llmModel: str | None = None
    temperature: float | None = None
    systemPrompt: str | None = None
    maxTokens: int | None = None
    streamResponses: bool | None = None
    theme: str | None = None
    compactMode: bool | None = None
    sidebarSize: float | None = None
    chatPanelSize: float | None = None
    notificationsEnabled: bool | None = None
    reminderSound: bool | None = None
    saveHistory: bool | None = None
    analyticsEnabled: bool | None = None


class SettingsResponse(BaseModel):
    settings: dict  # The full settings object
    updated_at: str


class ScheduleSettingsResponse(BaseModel):
    """When the daily briefing and the weekly review fire, in the user's zone."""

    briefing_enabled: bool
    briefing_time: str = Field(description="HH:MM on the wall clock of `timezone`.")
    weekly_review_enabled: bool
    weekly_review_day: str = Field(description="monday … sunday")
    weekly_review_time: str
    timezone: str = Field(description="IANA zone; empty means the server's local zone.")
    effective_timezone: str = Field(description="The zone actually in use.")
    next_briefing_at: UtcDatetime | None = None
    next_weekly_review_at: UtcDatetime | None = None


class ScheduleSettingsUpdate(BaseModel):
    """A partial update; omitted fields keep their value."""

    briefing_enabled: bool | None = None
    briefing_time: str | None = None
    weekly_review_enabled: bool | None = None
    weekly_review_day: str | None = None
    weekly_review_time: str | None = None
    timezone: str | None = None

    @field_validator("briefing_time", "weekly_review_time")
    @classmethod
    def _clock(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not is_clock(value):
            raise ValueError("time must be HH:MM (24-hour)")
        return value

    @field_validator("weekly_review_day")
    @classmethod
    def _weekday(cls, value: str | None) -> str | None:
        if value is None:
            return None
        day = value.strip().lower()
        if day not in WEEKDAYS:
            raise ValueError("day must be monday … sunday")
        return day

    @field_validator("timezone")
    @classmethod
    def _zone(cls, value: str | None) -> str | None:
        if value is None:
            return None
        name = value.strip()
        if not is_zone(name):
            raise ValueError("unknown IANA time zone")
        return name
