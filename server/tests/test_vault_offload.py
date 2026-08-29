"""Blocking vault I/O must run off the event loop thread.

The Obsidian helpers (`obsidian_cli_service`, `obsidian_context_service`,
`obsidian_export_service`, `obsidian_vault_indexer`) are entirely synchronous:
they walk the vault and shell out to the Obsidian CLI (up to a 15 s timeout).
Every async caller therefore has to hand them to `asyncio.to_thread`, and the
module-level write queue has to be safe for the concurrent access that
introduces.
"""

import asyncio
import threading
from unittest.mock import patch

import pytest

from services import obsidian_cli_service as cli
from services import todo_service


# ---------------------------------------------------------------------------
# Step 1 — write-queue locking
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def clean_queue_state():
    cli._write_queue.clear()
    cli._dead_letter_queue.clear()
    cli._cli_error_log.clear()
    yield
    cli._write_queue.clear()
    cli._dead_letter_queue.clear()
    cli._cli_error_log.clear()


def test_flush_lock_is_reentrant():
    """`flush_queue` persists while holding the lock, so it must be an RLock."""
    assert isinstance(cli._flush_lock, type(threading.RLock()))


def test_persist_queue_inside_flush_lock_does_not_deadlock(tmp_path, monkeypatch):
    """`flush_queue` -> `_persist_queue` re-enters the lock; that must not hang."""
    monkeypatch.setattr(cli, "_QUEUE_FILE", str(tmp_path / "queue.json"))
    monkeypatch.setattr(cli, "_DEAD_LETTER_FILE", str(tmp_path / "dead.json"))

    cli._enqueue(cli.WriteOp(op="create", args={"path": "a.md", "content": "x"}))

    done = threading.Event()
    result: dict = {}

    def run_flush():
        with patch.object(cli, "_replay_op", return_value=True):
            result["flush"] = cli.flush_queue()
        done.set()

    worker = threading.Thread(target=run_flush, daemon=True)
    worker.start()
    assert done.wait(timeout=5), "flush_queue deadlocked on the reentrant persist"
    assert result["flush"]["succeeded"] == 1
    assert cli.get_queue_status()["pending"] == 0


def test_queue_mutations_are_thread_safe(tmp_path, monkeypatch):
    """Concurrent enqueue/read/flush must not corrupt or explode mid-iteration."""
    monkeypatch.setattr(cli, "_QUEUE_FILE", str(tmp_path / "queue.json"))
    monkeypatch.setattr(cli, "_DEAD_LETTER_FILE", str(tmp_path / "dead.json"))

    errors: list[BaseException] = []
    barrier = threading.Barrier(9)

    def enqueue_many():
        try:
            barrier.wait(timeout=5)
            for i in range(200):
                cli._enqueue(
                    cli.WriteOp(op="create", args={"path": f"n{i}.md", "content": ""})
                )
        except BaseException as exc:  # noqa: BLE001 - surfaced by the assert below
            errors.append(exc)

    def read_many():
        try:
            barrier.wait(timeout=5)
            for _ in range(200):
                cli.get_queue_status()
                cli.get_dead_letter_status()
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=enqueue_many, daemon=True) for _ in range(4)]
    threads += [threading.Thread(target=read_many, daemon=True) for _ in range(5)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)
        assert not thread.is_alive(), "queue lock deadlocked under concurrency"

    assert errors == []
    assert cli.get_queue_status()["pending"] == 800


# ---------------------------------------------------------------------------
# Step 2 — call sites are offloaded
# ---------------------------------------------------------------------------


class ThreadSpy:
    """Records the thread each call ran on."""

    def __init__(self, return_value=None):
        self.threads: list[threading.Thread] = []
        self.return_value = return_value

    def __call__(self, *args, **kwargs):
        self.threads.append(threading.current_thread())
        return self.return_value

    def ran_off(self, loop_thread: threading.Thread) -> bool:
        return bool(self.threads) and all(t is not loop_thread for t in self.threads)


@pytest.mark.asyncio
async def test_todo_create_exports_to_vault_off_the_event_loop_thread(db_session, tmp_path):
    """A vault export walks every markdown file; it must not stall the loop."""
    spy = ThreadSpy()
    loop_thread = threading.current_thread()

    with patch.object(todo_service.settings, "obsidian_vault_path", str(tmp_path)), \
         patch.object(todo_service, "export_todo", spy):
        todo = await todo_service.create_todo(db_session, title="Offloaded export")

    assert spy.ran_off(loop_thread)
    assert todo.title == "Offloaded export"


@pytest.mark.asyncio
async def test_todo_delete_removes_from_vault_off_the_event_loop_thread(db_session, tmp_path):
    spy = ThreadSpy()
    loop_thread = threading.current_thread()
    todo = await todo_service.create_todo(db_session, title="To remove")

    with patch.object(todo_service.settings, "obsidian_vault_path", str(tmp_path)), \
         patch.object(todo_service, "remove_todo_from_vault", spy):
        await todo_service.delete_todo(db_session, todo.id)

    assert spy.ran_off(loop_thread)


@pytest.mark.asyncio
async def test_reindex_endpoint_offloads_the_full_vault_scan():
    """`refresh_index` walks the whole vault and shells out to the CLI twice."""
    from routers import obsidian as obsidian_router
    from services import obsidian_vault_indexer as indexer

    loop_thread = threading.current_thread()
    seen: list[threading.Thread] = []

    def fake_refresh_index():
        seen.append(threading.current_thread())
        return indexer.VaultIndex()

    with patch.object(indexer, "refresh_index", fake_refresh_index):
        payload = await obsidian_router.trigger_reindex(_user="tester")

    assert seen and seen[0] is not loop_thread
    assert "project_count" in payload


@pytest.mark.asyncio
async def test_execute_cli_command_endpoint_offloads_the_subprocess():
    """`_run_cli` blocks for up to 15 s waiting on the Obsidian CLI."""
    from routers import obsidian as obsidian_router

    loop_thread = threading.current_thread()
    seen: list[threading.Thread] = []

    def fake_run_cli(*args, **kwargs):
        seen.append(threading.current_thread())
        return None

    with patch.object(cli, "_run_cli", fake_run_cli):
        payload = await obsidian_router.execute_cli_command(
            command_id="app:reload", _user="tester"
        )

    assert seen and seen[0] is not loop_thread
    assert payload == {
        "success": False,
        "error": "CLI command failed or not available",
    }


@pytest.mark.asyncio
async def test_queue_endpoints_offload_queue_operations():
    from routers import obsidian as obsidian_router

    loop_thread = threading.current_thread()
    status_spy = ThreadSpy(return_value={"pending": 0})
    flush_spy = ThreadSpy(return_value={"processed": 0})

    with patch.object(cli, "get_queue_status", status_spy):
        await obsidian_router.get_write_queue(_user="tester")
    with patch.object(cli, "flush_queue", flush_spy):
        await obsidian_router.flush_write_queue(_user="tester")

    assert status_spy.ran_off(loop_thread)
    assert flush_spy.ran_off(loop_thread)


@pytest.mark.asyncio
async def test_offloaded_queue_flush_does_not_block_the_event_loop():
    """End-to-end: a slow flush must leave the loop free to serve other work."""
    from routers import obsidian as obsidian_router

    def slow_flush():
        threading.Event().wait(0.3)
        return {"processed": 0, "succeeded": 0, "failed": 0, "dead_lettered": 0}

    ticks = 0

    async def tick():
        nonlocal ticks
        while True:
            await asyncio.sleep(0.01)
            ticks += 1

    ticker = asyncio.create_task(tick())
    try:
        with patch.object(cli, "flush_queue", slow_flush):
            await obsidian_router.flush_write_queue(_user="tester")
    finally:
        ticker.cancel()
        await asyncio.gather(ticker, return_exceptions=True)

    assert ticks > 5, "the event loop was blocked during the flush"
