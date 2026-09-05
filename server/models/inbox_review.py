"""User review preferences and bounded, revision-bound preview cache."""

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class InboxReviewPreference(Base):
    __tablename__ = "inbox_review_preferences"
    owner: Mapped[str] = mapped_column(String, primary_key=True)
    task_id: Mapped[str] = mapped_column(
        String, ForeignKey("todos.id", ondelete="CASCADE"), primary_key=True
    )
    deferred: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    exclude_deadline: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="0"
    )
    choice_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    choice_revision: Mapped[int | None] = mapped_column(Integer, nullable=True)


class InboxPreviewCache(Base):
    __tablename__ = "inbox_preview_cache"
    owner: Mapped[str] = mapped_column(String, primary_key=True)
    cache_key: Mapped[str] = mapped_column(String, primary_key=True)
    revision: Mapped[int] = mapped_column(Integer)
    payload: Mapped[str] = mapped_column(Text)
