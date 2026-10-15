"""Data a device keeps on its own disk and lets other devices look at.

A data source is a folder on one machine -- an Obsidian vault, say -- that the
machine's desktop app has offered for reading. The contents never move: when a
phone asks for a note, the request is queued here, the app on the machine that
holds the folder answers it, and the answer is handed back. All the server
keeps is a light index (paths, titles, modification times) so the phone can
still browse while the machine is asleep, and a record of every request.

The folder's location on its machine is not stored here. The desktop app maps
the source id to its own path, so the server cannot name a path on a disk it
never reads.
"""

from datetime import datetime, timezone

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from database import Base
from utils import make_id

#: What kind of data a source holds. Obsidian is the first; a plain folder
#: covers anything else that is files on a disk.
DATA_SOURCE_KINDS = ("obsidian_vault", "folder")
#: Read-only operations. Writing is a later phase and goes through review.
DATA_SOURCE_OPERATIONS = ("list", "read", "search")
#: queued -> claimed -> done | failed. ``denied`` never reaches the device;
#: ``expired`` means the asker stopped waiting before an answer came.
DATA_QUERY_STATUSES = ("queued", "claimed", "done", "failed", "denied", "expired")


def _now() -> datetime:
    return datetime.now(timezone.utc)


class DataSource(Base):
    __tablename__ = "data_sources"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: make_id("dsrc_")
    )
    #: The machine that holds the data and answers for it.
    host_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("execution_hosts.id", ondelete="CASCADE"),
        nullable=False,
    )
    kind: Mapped[str] = mapped_column(String, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    #: JSON list drawn from ``DATA_SOURCE_OPERATIONS``.
    capabilities: Mapped[str] = mapped_column(Text, nullable=False, default='["list","read","search"]')
    #: JSON list of folders, relative to the source root, that may be read.
    #: Empty means the whole source.
    include_folders: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    #: JSON list of folders that may never be read, even inside an included one.
    exclude_folders: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    #: When the machine last asked for requests. Kept apart from the host's own
    #: ``last_seen_at``: offering a folder for reading must not make the
    #: machine look ready to run delegated work.
    last_seen_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    index_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )

    __table_args__ = (
        CheckConstraint(
            "kind IN ('obsidian_vault', 'folder')",
            name="ck_data_sources_kind_valid",
        ),
        UniqueConstraint("host_id", "name", name="uq_data_sources_host_name"),
        Index("idx_data_sources_host_id", "host_id"),
    )


class DataSourceEntry(Base):
    """One file in a source's light index: where it is and what it is called.

    Never the contents. This is what a phone sees while the machine is off.
    """

    __tablename__ = "data_source_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("data_sources.id", ondelete="CASCADE"),
        nullable=False,
    )
    #: Relative to the source root, ``/``-separated, NFC.
    path: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    modified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        UniqueConstraint("source_id", "path", name="uq_data_source_entries_source_path"),
    )


class DataSourceQuery(Base):
    """One request for a source's data, and the record that it was made.

    The answer is held only until the asker collects it, then dropped: the
    server relays the contents, it does not keep them. Everything else stays
    as the audit trail of who asked to read what.
    """

    __tablename__ = "data_source_queries"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: make_id("dq_")
    )
    source_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("data_sources.id", ondelete="CASCADE"),
        nullable=False,
    )
    host_id: Mapped[str] = mapped_column(String, nullable=False)
    op: Mapped[str] = mapped_column(String, nullable=False)
    path: Mapped[str | None] = mapped_column(Text, nullable=True)
    query: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="queued")
    #: Who asked: a paired device id, or ``user`` for a PIN session.
    requested_by: Mapped[str] = mapped_column(Text, nullable=False)
    #: Why the request was refused or failed, in a word the clients can match.
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: JSON answer from the device, cleared once the asker has it.
    result: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Size of the answer, kept after the answer itself is gone.
    result_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    claimed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        CheckConstraint(
            "status IN ('queued', 'claimed', 'done', 'failed', 'denied', 'expired')",
            name="ck_data_source_queries_status_valid",
        ),
        CheckConstraint(
            "op IN ('list', 'read', 'search')",
            name="ck_data_source_queries_op_valid",
        ),
        Index("idx_data_source_queries_host_status", "host_id", "status", "created_at"),
        Index("idx_data_source_queries_source_created", "source_id", "created_at"),
    )
