
from pydantic import BaseModel, Field
from schemas._utc import UtcDatetime


class CalendarSourceResponse(BaseModel):
    id: str
    display_name: str
    color: str | None
    import_enabled: bool
    is_write_target: bool
    last_synced_at: UtcDatetime | None


class CalendarAccountResponse(BaseModel):
    id: str
    label: str
    server_url: str
    username: str
    last_sync_at: UtcDatetime | None
    last_error: str | None
    calendars: list[CalendarSourceResponse]


class CalendarAccountListResponse(BaseModel):
    accounts: list[CalendarAccountResponse]


class CalendarAccountCreate(BaseModel):
    label: str = Field(default="", max_length=100)
    server_url: str = Field(min_length=1, max_length=500)
    username: str = Field(min_length=1, max_length=300)
    password: str = Field(min_length=1, max_length=500)


class CalendarSourceUpdate(BaseModel):
    import_enabled: bool | None = None
    is_write_target: bool | None = None
