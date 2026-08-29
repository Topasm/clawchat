"""Concurrency ordering coverage for durable Vault reconciliation."""

import asyncio
import json
import threading
from datetime import datetime, timezone
from pathlib import Path

import pytest
from config import settings
from database import Base
from domain.plan_proposal import VaultSyncJobStatus
from models.task_graph_state import TaskGraphState
from models.todo import Todo
from models.vault_sync_job import VaultSyncJob
from services.vault import vault_sync_service
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


@pytest.mark.asyncio
async def test_older_job_finishing_last_reconciles_latest_canonical_snapshot(
    monkeypatch,
    tmp_path: Path,
):
    vault_path = tmp_path / "vault"
    vault_path.mkdir()
    todo_file = vault_path / "00_Inbox" / "TODO.md"
    todo_file.parent.mkdir()
    todo_file.write_text(
        "# Personal tasks\n\nThis user-authored note must remain.\n",
        encoding="utf-8",
    )
    database_path = tmp_path / "vault-ordering.db"
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{database_path.as_posix()}",
        pool_size=3,
        max_overflow=0,
    )
    session_factory = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    monkeypatch.setattr(settings, "obsidian_vault_path", str(vault_path))

    old_write_started = threading.Event()
    release_old_write = threading.Event()
    real_reconcile = vault_sync_service.reconcile_todos_in_vault
    observed_titles: list[str] = []

    def controlled_reconcile(vault, items, removed_todo_ids):
        title = items[0][0].title
        observed_titles.append(title)
        if title == "Old snapshot" and not old_write_started.is_set():
            old_write_started.set()
            if not release_old_write.wait(timeout=5):
                raise TimeoutError("old Vault write was not released")
        return real_reconcile(vault, items, removed_todo_ids)

    monkeypatch.setattr(
        vault_sync_service,
        "reconcile_todos_in_vault",
        controlled_reconcile,
    )

    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

        async with session_factory() as seed_db:
            root = Todo(id="todo_root", title="Old snapshot")
            seed_db.add(root)
            await seed_db.flush()
            state = await seed_db.get(TaskGraphState, "global")
            assert state is not None
            old_revision = state.revision
            seed_db.add(
                VaultSyncJob(
                    id="vault_job_old",
                    event_type="task_plan_applied",
                    aggregate_id=root.id,
                    payload_json=json.dumps(
                        {
                            "todo_ids": [root.id],
                            "removed_todo_ids": [],
                            "graph_revision": old_revision,
                        }
                    ),
                    dedupe_key="old-job",
                    available_at=datetime.now(timezone.utc),
                )
            )
            await seed_db.commit()

        async def process_old_job() -> VaultSyncJobStatus:
            async with session_factory() as old_db:
                return await vault_sync_service.process_vault_sync_job(
                    old_db,
                    "vault_job_old",
                )

        old_delivery = asyncio.create_task(process_old_job())
        started = await asyncio.to_thread(old_write_started.wait, 5)
        assert started, "old Vault delivery did not reach the filesystem"

        async with session_factory() as update_db:
            root = await update_db.get(Todo, "todo_root")
            assert root is not None
            root.title = "New canonical"
            await update_db.flush()
            state = await update_db.get(TaskGraphState, "global")
            assert state is not None
            new_revision = state.revision
            update_db.add(
                VaultSyncJob(
                    id="vault_job_new",
                    event_type="task_plan_applied",
                    aggregate_id=root.id,
                    payload_json=json.dumps(
                        {
                            "todo_ids": [root.id],
                            "removed_todo_ids": [],
                            "graph_revision": new_revision,
                        }
                    ),
                    dedupe_key="new-job",
                    available_at=datetime.now(timezone.utc),
                )
            )
            await update_db.commit()

        async with session_factory() as new_db:
            new_status = await vault_sync_service.process_vault_sync_job(
                new_db,
                "vault_job_new",
            )
        assert new_status == VaultSyncJobStatus.SUCCEEDED

        # Let the older snapshot overwrite the newer file once. Its post-write
        # revision check must notice the race, re-read DB state, and restore the
        # canonical value before reporting success.
        release_old_write.set()
        assert await old_delivery == VaultSyncJobStatus.SUCCEEDED

        contents = todo_file.read_text(encoding="utf-8")
        assert "# Personal tasks" in contents
        assert "This user-authored note must remain." in contents
        assert "New canonical" in contents
        assert "Old snapshot" not in contents
        assert observed_titles == [
            "Old snapshot",
            "New canonical",
            "New canonical",
        ]
    finally:
        release_old_write.set()
        await engine.dispose()
