"""Canonical lifecycle values for versioned task-plan proposals."""

from enum import StrEnum


GLOBAL_TASK_GRAPH_SCOPE_ID = "global"


class PlanProposalStatus(StrEnum):
    """Lifecycle of one immutable, versioned planning proposal."""

    GENERATING = "generating"
    DRAFT = "draft"
    APPLYING = "applying"
    APPLIED = "applied"
    REJECTED = "rejected"
    STALE = "stale"
    REVERTED = "reverted"
    FAILED = "failed"


class ChangeSetStatus(StrEnum):
    """Lifecycle of the durable mutation record for one proposal apply."""

    APPLYING = "applying"
    APPLIED = "applied"
    REVERTED = "reverted"
    FAILED = "failed"


class VaultSyncJobStatus(StrEnum):
    """Delivery state for a durable vault reconciliation job."""

    PENDING = "pending"
    PROCESSING = "processing"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


def _values(enum_type: type[StrEnum]) -> tuple[str, ...]:
    return tuple(member.value for member in enum_type)


def _check_sql(column: str, values: tuple[str, ...]) -> str:
    serialized = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({serialized})"


PLAN_PROPOSAL_STATUS_VALUES = _values(PlanProposalStatus)
PLAN_PROPOSAL_STATUS_CHECK_SQL = _check_sql(
    "status",
    PLAN_PROPOSAL_STATUS_VALUES,
)

CHANGE_SET_STATUS_VALUES = _values(ChangeSetStatus)
CHANGE_SET_STATUS_CHECK_SQL = _check_sql("status", CHANGE_SET_STATUS_VALUES)

VAULT_SYNC_JOB_STATUS_VALUES = _values(VaultSyncJobStatus)
VAULT_SYNC_JOB_STATUS_CHECK_SQL = _check_sql(
    "status",
    VAULT_SYNC_JOB_STATUS_VALUES,
)
