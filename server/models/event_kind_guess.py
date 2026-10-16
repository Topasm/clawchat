from datetime import datetime, timezone

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class EventKindGuess(Base):
    """What the AI said an event the title rules missed calls for.

    One row per event UID, kept whatever the answer (``none`` included), so a
    title is sent to the AI once. A changed title is asked about again.
    """

    __tablename__ = "event_kind_guesses"

    subject_key: Mapped[str] = mapped_column(Text, primary_key=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    # prepare_exam | submit | prepare_talk | prepare_meeting | none
    kind: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
