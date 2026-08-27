"""Data-model and runtime graph-revision coverage for versioned plans."""

from pathlib import Path

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from database import (
    Base,
    _apply_schema_corrections,
    _run_data_migrations,
    _setup_task_graph_revision,
)
from domain.plan_proposal import (
    GLOBAL_TASK_GRAPH_SCOPE_ID,
    ChangeSetStatus,
    PlanProposalStatus,
    VaultSyncJobStatus,
)
from models.agent_task import AgentTask
from models.change_set import ChangeSet
from models.plan_proposal import PlanProposal
from models.task_graph_state import TaskGraphState
from models.task_relationship import TaskRelationship
from models.todo import Todo
from models.vault_sync_job import VaultSyncJob

_REVISION_TRIGGER_NAMES = {
    "todos_bump_task_graph_revision_insert",
    "todos_bump_task_graph_revision_update",
    "todos_bump_task_graph_revision_delete",
    "task_relationships_bump_graph_revision_insert",
    "task_relationships_bump_graph_revision_update",
    "task_relationships_bump_graph_revision_delete",
}


async def _graph_revision(session: AsyncSession) -> int:
    return (
        await session.execute(
            select(TaskGraphState.revision).where(
                TaskGraphState.scope_id == GLOBAL_TASK_GRAPH_SCOPE_ID
            )
        )
    ).scalar_one()


async def _revision_trigger_names(session: AsyncSession) -> set[str]:
    rows = await session.execute(
        text(
            "SELECT name FROM sqlite_master "
            "WHERE type = 'trigger' AND ("
            "name LIKE 'todos_bump_task_graph_revision_%' OR "
            "name LIKE 'task_relationships_bump_graph_revision_%')"
        )
    )
    return set(rows.scalars())


@pytest.mark.asyncio
async def test_create_all_seeds_state_and_revision_triggers_track_graph_changes(
    db_session: AsyncSession,
):
    assert await _graph_revision(db_session) == 0
    assert await _revision_trigger_names(db_session) == _REVISION_TRIGGER_NAMES

    prerequisite = Todo(id="todo_prerequisite", title="Prerequisite")
    dependent = Todo(id="todo_dependent", title="Dependent")
    db_session.add_all([prerequisite, dependent])
    await db_session.commit()
    assert await _graph_revision(db_session) == 2

    await db_session.execute(
        text(
            "UPDATE todos SET inbox_state = 'accepted', "
            "automation_error = 'retryable', updated_at = CURRENT_TIMESTAMP, "
            "depends_on = '[]' WHERE id = :todo_id"
        ),
        {"todo_id": dependent.id},
    )
    await db_session.commit()
    assert await _graph_revision(db_session) == 2

    # UPDATE OF is not sufficient: the NULL-safe WHEN expression must also
    # suppress a no-op semantic write and count both NULL transitions.
    await db_session.execute(
        text("UPDATE todos SET description = description WHERE id = :todo_id"),
        {"todo_id": dependent.id},
    )
    await db_session.commit()
    assert await _graph_revision(db_session) == 2

    await db_session.execute(
        text("UPDATE todos SET description = 'detail' WHERE id = :todo_id"),
        {"todo_id": dependent.id},
    )
    await db_session.commit()
    assert await _graph_revision(db_session) == 3

    await db_session.execute(
        text("UPDATE todos SET description = NULL WHERE id = :todo_id"),
        {"todo_id": dependent.id},
    )
    await db_session.commit()
    assert await _graph_revision(db_session) == 4

    relationship = TaskRelationship(
        id="rel_dependency",
        source_task_id=dependent.id,
        target_task_id=prerequisite.id,
        type="depends_on",
    )
    db_session.add(relationship)
    await db_session.commit()
    assert await _graph_revision(db_session) == 5

    relationship.label = "must finish first"
    await db_session.commit()
    assert await _graph_revision(db_session) == 6

    await db_session.delete(relationship)
    await db_session.commit()
    assert await _graph_revision(db_session) == 7

    await db_session.delete(dependent)
    await db_session.commit()
    assert await _graph_revision(db_session) == 8

    # Repeated startup must preserve the monotonic revision and trigger set.
    await _setup_task_graph_revision(db_session)
    assert await _graph_revision(db_session) == 8
    assert await _revision_trigger_names(db_session) == _REVISION_TRIGGER_NAMES


@pytest.mark.asyncio
async def test_legacy_create_all_defers_todo_triggers_until_corrections(
    tmp_path: Path,
):
    database_path = tmp_path / "legacy-runtime.db"
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{database_path.as_posix()}"
    )
    session_factory = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    try:
        async with engine.begin() as connection:
            await connection.execute(
                text(
                    """
                    CREATE TABLE todos (
                        id TEXT PRIMARY KEY,
                        title TEXT NOT NULL,
                        description TEXT,
                        status TEXT NOT NULL,
                        priority TEXT NOT NULL,
                        due_date DATETIME,
                        completed_at DATETIME,
                        conversation_id TEXT,
                        message_id TEXT,
                        created_at DATETIME NOT NULL,
                        updated_at DATETIME NOT NULL,
                        tags TEXT
                    )
                    """
                )
            )
            # The metadata callback must not compile OLD/NEW references to
            # columns that schema correction has not added yet.
            await connection.run_sync(Base.metadata.create_all)

        async with session_factory() as session:
            names_before = await _revision_trigger_names(session)
            assert not {
                name for name in names_before if name.startswith("todos_")
            }
            assert await _graph_revision(session) == 0

            await _apply_schema_corrections(session)
            await _setup_task_graph_revision(session)
            assert await _revision_trigger_names(session) == _REVISION_TRIGGER_NAMES

            await session.execute(
                text(
                    "INSERT INTO todos "
                    "(id, title, status, priority, created_at, updated_at) "
                    "VALUES ('todo_after_correction', 'Ready', 'pending', "
                    "'medium', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
            )
            await session.commit()
            assert await _graph_revision(session) == 1
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_runtime_compatibility_upgrade_retains_legacy_plan_history(
    db_session: AsyncSession,
):
    root = Todo(id="todo_legacy_root", title="Legacy project")
    prerequisite = Todo(id="todo_legacy_prerequisite", title="Existing child")
    db_session.add_all([root, prerequisite])
    await db_session.commit()
    valid_payload = '{"summary":"legacy","subtasks":[{"title":"Step"}]}'
    applied_task = AgentTask(
        id="task_legacy_applied",
        task_type="plan_todo",
        agent_type="plan",
        instruction="legacy apply",
        status="completed",
        todo_id=root.id,
        payload_json=valid_payload,
    )
    stale_task = AgentTask(
        id="task_legacy_stale",
        task_type="plan_todo",
        agent_type="plan",
        instruction="legacy preview",
        status="completed",
        todo_id=root.id,
        payload_json=valid_payload,
    )
    invalid_task = AgentTask(
        id="task_legacy_invalid",
        task_type="plan_todo",
        agent_type="plan",
        instruction="legacy malformed output",
        status="completed",
        todo_id=root.id,
        payload_json="not-json",
    )
    db_session.add_all([applied_task, stale_task, invalid_task])
    await db_session.flush()
    db_session.add(
        TaskRelationship(
            id="rel_legacy_proposal",
            source_task_id=root.id,
            target_task_id=prerequisite.id,
            type="related",
            created_by="ai",
            proposal_id=applied_task.id,
        )
    )
    await db_session.commit()

    await _run_data_migrations(db_session)
    await _run_data_migrations(db_session)

    proposals = {
        proposal.id: proposal
        for proposal in (
            await db_session.execute(
                select(PlanProposal).where(
                    PlanProposal.id.in_(
                        [applied_task.id, stale_task.id, invalid_task.id]
                    )
                )
            )
        ).scalars()
    }
    assert set(proposals) == {
        applied_task.id,
        stale_task.id,
        invalid_task.id,
    }
    assert proposals[applied_task.id].status == PlanProposalStatus.APPLIED
    assert proposals[stale_task.id].status == PlanProposalStatus.STALE
    assert proposals[invalid_task.id].status == PlanProposalStatus.FAILED
    assert all(proposal.base_graph_revision is None for proposal in proposals.values())
    assert all(not proposal.is_revertible for proposal in proposals.values())


def test_lifecycle_enums_are_validated_at_orm_boundary():
    assert PlanProposal(status=PlanProposalStatus.DRAFT).status == "draft"
    assert ChangeSet(
        proposal_id="proposal",
        request_hash="hash",
        base_graph_revision=0,
        status=ChangeSetStatus.APPLIED,
    ).status == "applied"
    assert VaultSyncJob(
        event_type="todo.upsert",
        aggregate_id="todo",
        dedupe_key="dedupe",
        status=VaultSyncJobStatus.SUCCEEDED,
    ).status == "succeeded"

    with pytest.raises(ValueError, match="Invalid plan proposal status"):
        PlanProposal(status="unknown")
    with pytest.raises(ValueError, match="Invalid change-set status"):
        ChangeSet(
            proposal_id="proposal",
            request_hash="hash",
            base_graph_revision=0,
            status="unknown",
        )
    with pytest.raises(ValueError, match="Invalid vault sync status"):
        VaultSyncJob(
            event_type="todo.upsert",
            aggregate_id="todo",
            dedupe_key="dedupe",
            status="unknown",
        )


@pytest.mark.asyncio
async def test_change_set_and_outbox_idempotency_keys_are_unique(
    db_session: AsyncSession,
):
    proposal = PlanProposal(id="proposal_unique", status="draft")
    db_session.add(proposal)
    await db_session.commit()

    db_session.add(
        ChangeSet(
            id="changeset_first",
            proposal_id=proposal.id,
            request_hash="request-one",
            base_graph_revision=0,
        )
    )
    await db_session.commit()
    db_session.add(
        ChangeSet(
            id="changeset_second",
            proposal_id=proposal.id,
            request_hash="request-two",
            base_graph_revision=0,
        )
    )
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()

    db_session.add(
        VaultSyncJob(
            id="vault_job_first",
            event_type="todo.upsert",
            aggregate_id="todo_one",
            dedupe_key="todo_one:revision:1",
        )
    )
    await db_session.commit()
    db_session.add(
        VaultSyncJob(
            id="vault_job_second",
            event_type="todo.upsert",
            aggregate_id="todo_one",
            dedupe_key="todo_one:revision:1",
        )
    )
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()
