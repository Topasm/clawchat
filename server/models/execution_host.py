"""Machines that can run a project's work, and where that work lives on each.

A workspace path only means something together with the machine it exists on:
`/Users/me/papers` is real on a laptop and absent on the server. A project
therefore records its path per host, and names the one host its work runs on.

Work is never moved to another host on its own. A project pinned to a laptop
that is asleep waits for that laptop: running it somewhere else would be
running it against different files.
"""

from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, validates

from database import Base
from utils import make_id

#: "local" is the machine the server itself runs on. "paseo" is reached
#: through the Paseo CLI. "worker" is a ClawChat desktop app that checks in and
#: runs work on the machine it is installed on.
EXECUTION_HOST_KINDS = ("local", "paseo", "worker")


class ExecutionHost(Base):
    __tablename__ = "execution_hosts"

    id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        default=lambda: make_id("host_"),
    )
    label: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(
        String,
        nullable=False,
        default="local",
        server_default="local",
    )
    #: Connection string for a remote kind; unused by "local".
    target: Mapped[str | None] = mapped_column(Text, nullable=True)
    platform: Mapped[str | None] = mapped_column(String, nullable=True)
    is_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default="1",
    )
    last_seen_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    @validates("kind")
    def _validate_kind(self, _key: str, value: str) -> str:
        if value not in EXECUTION_HOST_KINDS:
            allowed = ", ".join(EXECUTION_HOST_KINDS)
            raise ValueError(f"Invalid execution host kind {value!r}; expected one of: {allowed}")
        return value

    __table_args__ = (
        CheckConstraint(
            "kind IN ('local', 'paseo', 'worker')",
            name="ck_execution_hosts_kind_valid",
        ),
        UniqueConstraint("label", name="uq_execution_hosts_label"),
        Index("idx_execution_hosts_is_enabled", "is_enabled"),
    )


class ProjectHostPath(Base):
    """Where one project's work lives on one host."""

    __tablename__ = "project_host_paths"

    id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        default=lambda: make_id("hostpath_"),
    )
    project_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    host_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("execution_hosts.id", ondelete="CASCADE"),
        nullable=False,
    )
    path: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    __table_args__ = (
        UniqueConstraint(
            "project_id",
            "host_id",
            name="uq_project_host_paths_project_host",
        ),
        Index("idx_project_host_paths_project_id", "project_id"),
    )
