from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base
from utils import make_id


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: make_id("msg_"))
    conversation_id: Mapped[str] = mapped_column(
        String, ForeignKey("conversations.id"), nullable=False
    )
    role: Mapped[str] = mapped_column(String, nullable=False)  # user, assistant, system
    content: Mapped[str] = mapped_column(Text, nullable=False)
    message_type: Mapped[str] = mapped_column(String, nullable=False, default="text")
    intent: Mapped[str | None] = mapped_column(String, nullable=True)
    # Client-supplied de-duplication token. Clients retry a send when the
    # first attempt fails after the server already committed the message, so
    # the unique index below is what actually prevents the duplicate.
    idempotency_key: Mapped[str | None] = mapped_column(String, nullable=True)
    metadata_json: Mapped[str | None] = mapped_column("metadata", Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )

    conversation = relationship("Conversation", back_populates="messages")

    __table_args__ = (
        Index("idx_messages_conversation_id", "conversation_id"),
        Index("idx_messages_created_at", "created_at"),
        Index(
            "uq_messages_conversation_idempotency_key",
            "conversation_id",
            "idempotency_key",
            unique=True,
            sqlite_where=text("idempotency_key IS NOT NULL"),
            postgresql_where=text("idempotency_key IS NOT NULL"),
        ),
    )
