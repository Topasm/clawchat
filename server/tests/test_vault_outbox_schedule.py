import asyncio
import json
from datetime import datetime, timedelta, timezone

from domain.plan_proposal import VaultSyncJobStatus
from models.vault_sync_job import VaultSyncJob
from services.vault import vault_sync_service as outbox


def _job(job_id: str, status: VaultSyncJobStatus, **fields) -> VaultSyncJob:
    return VaultSyncJob(
        id=job_id,
        event_type="task_plan_applied",
        aggregate_id="todo_1",
        payload_json=json.dumps({"todo_ids": [], "removed_todo_ids": []}),
        dedupe_key=job_id,
        status=status,
        **fields,
    )


async def test_an_empty_outbox_sleeps_for_the_longest_wait(db_session):
    wait = await outbox.seconds_until_next_vault_sync_job(db_session)
    assert wait == outbox.OUTBOX_MAX_WAIT_SECONDS


async def test_sleeps_until_the_next_retry_within_bounds(db_session):
    now = datetime.now(timezone.utc)
    db_session.add(
        _job("later", VaultSyncJobStatus.FAILED, available_at=now + timedelta(seconds=90))
    )
    db_session.add(
        _job("done", VaultSyncJobStatus.SUCCEEDED, available_at=now - timedelta(hours=1))
    )
    await db_session.commit()
    assert 80 < await outbox.seconds_until_next_vault_sync_job(db_session) <= 90

    db_session.add(_job("due", VaultSyncJobStatus.PENDING, available_at=now))
    await db_session.commit()
    wait = await outbox.seconds_until_next_vault_sync_job(db_session)
    assert wait == outbox.OUTBOX_MIN_WAIT_SECONDS


async def test_wakes_for_an_abandoned_lease(db_session):
    now = datetime.now(timezone.utc)
    db_session.add(
        _job(
            "stuck",
            VaultSyncJobStatus.PROCESSING,
            available_at=now - timedelta(minutes=5),
            locked_at=now - timedelta(minutes=4),
        )
    )
    await db_session.commit()
    assert 50 < await outbox.seconds_until_next_vault_sync_job(db_session) <= 60


async def test_a_failed_delivery_wakes_the_sleeping_outbox(db_session, monkeypatch):
    now = datetime.now(timezone.utc)
    db_session.add(_job("bad", VaultSyncJobStatus.PENDING, available_at=now))
    await db_session.commit()

    async def fail(*_args, **_kwargs):
        raise RuntimeError("vault offline")

    monkeypatch.setattr(outbox.settings, "obsidian_vault_path", "/vault")
    monkeypatch.setattr(outbox, "_reconcile_latest_snapshot", fail)
    watch = outbox.watch_vault_outbox()
    sleeper = asyncio.ensure_future(outbox.wait_for_vault_outbox(watch, 60))
    await asyncio.sleep(0)

    status = await outbox.process_vault_sync_job(db_session, "bad")

    assert status == VaultSyncJobStatus.FAILED
    await asyncio.wait_for(sleeper, 1)


async def test_an_unwoken_outbox_sleeps_out_its_timeout():
    watch = outbox.watch_vault_outbox()
    await asyncio.wait_for(outbox.wait_for_vault_outbox(watch, 0.01), 1)
    assert not watch.is_set()
