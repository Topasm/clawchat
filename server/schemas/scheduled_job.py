from datetime import datetime

from pydantic import BaseModel, Field


class ScheduledJobCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    instruction: str = Field(min_length=1, max_length=8_000)
    skill_chain: list[str] = Field(min_length=1, max_length=5)
    project_id: str | None = None
    include_task_snapshot: bool = True
    rrule: str = Field(
        min_length=1,
        max_length=500,
        description=(
            "An RRULE without DTSTART, e.g. FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0. "
            "Times are wall-clock times in `timezone`."
        ),
    )
    timezone: str = Field(min_length=1, max_length=64, description="IANA zone name")
    enabled: bool = True


class ScheduledJobUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    instruction: str | None = Field(default=None, min_length=1, max_length=8_000)
    skill_chain: list[str] | None = Field(default=None, min_length=1, max_length=5)
    # Send null explicitly to detach the job from its project.
    project_id: str | None = None
    include_task_snapshot: bool | None = None
    rrule: str | None = Field(default=None, min_length=1, max_length=500)
    timezone: str | None = Field(default=None, min_length=1, max_length=64)
    enabled: bool | None = None


class ScheduledJobResponse(BaseModel):
    id: str
    title: str
    instruction: str
    skill_chain: list[str]
    project_id: str | None
    project_title: str | None
    include_task_snapshot: bool
    rrule: str
    timezone: str
    enabled: bool
    next_run_at: datetime | None
    conversation_id: str | None
    last_run_at: datetime | None
    last_run_id: str | None
    last_run_status: str | None
    last_error: str | None
    created_at: datetime
    updated_at: datetime


class ScheduledJobListResponse(BaseModel):
    jobs: list[ScheduledJobResponse]


class ScheduledJobRunResponse(BaseModel):
    run_id: str
    conversation_id: str | None
