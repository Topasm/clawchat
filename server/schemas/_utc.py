"""Datetimes leave the API with their zone.

SQLite hands stored UTC datetimes back naive, and a naive datetime serialises
without an offset, which a browser reads as local time: every run, task and
review timestamp showed nine hours off in Korea. Response fields use this
type so a naive value is stamped UTC before it is serialised; aware values
pass through unchanged.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from pydantic import AfterValidator


def as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


UtcDatetime = Annotated[datetime, AfterValidator(as_utc)]
