"""Server-owned values for the tools agents may call."""

from enum import StrEnum


class McpTransport(StrEnum):
    STDIO = "stdio"
    HTTP = "http"


class ToolTrust(StrEnum):
    """Whether a server's tools may run without asking the user first."""

    READ_ONLY = "read_only"
    APPROVAL = "approval"


class ToolCallStatus(StrEnum):
    PENDING_APPROVAL = "pending_approval"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    DENIED = "denied"


class ToolDecision(StrEnum):
    ALLOW = "allow"
    DENY = "deny"
