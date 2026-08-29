"""Incremental vault watcher and index refresh tests."""

import os
import threading
from unittest.mock import patch

import pytest

from models.todo import Todo
from services import obsidian_vault_indexer as indexer
from services import vault_watcher_service as watcher
from services.scheduler import _is_watchable_vault_path


@pytest.mark.asyncio
async def test_incremental_scan_reads_only_changed_todo_file(db_session, tmp_path):
    changed_todo = Todo(title="Before")
    untouched_todo = Todo(title="Untouched")
    db_session.add_all([changed_todo, untouched_todo])
    await db_session.commit()

    changed_file = tmp_path / "Changed" / "TODO.md"
    untouched_file = tmp_path / "Untouched" / "TODO.md"
    changed_file.parent.mkdir()
    untouched_file.parent.mkdir()
    changed_file.write_text(
        f"- [x] Before <!-- claw:{changed_todo.id} -->\n", encoding="utf-8"
    )
    untouched_file.write_text(
        f"- [ ] Modified but not signaled <!-- claw:{untouched_todo.id} -->\n",
        encoding="utf-8",
    )
    watcher._file_hashes.clear()

    with patch.object(watcher.settings, "obsidian_vault_path", str(tmp_path)), \
         patch.object(watcher.settings, "obsidian_project_todo_filename", "TODO.md"), \
         patch("services.vault_watcher_service.os.walk", side_effect=AssertionError("walked")):
        result = await watcher.scan_vault(db_session, {str(changed_file)})

    await db_session.refresh(changed_todo)
    await db_session.refresh(untouched_todo)
    assert result.scan_mode == "incremental"
    assert result.files_scanned == 1
    assert changed_todo.status == "completed"
    assert untouched_todo.status == "pending"


def test_incremental_index_refresh_updates_only_affected_project(tmp_path):
    project = tmp_path / "Project"
    project.mkdir()
    (project / "TODO.md").write_text("# Tasks\n", encoding="utf-8")
    note = project / "notes.md"
    note.write_text("old summary", encoding="utf-8")
    indexer._index = indexer.VaultIndex()

    with patch.object(indexer.settings, "obsidian_vault_path", str(tmp_path)), \
         patch.object(indexer.settings, "obsidian_cli_command", ""), \
         patch.object(indexer.settings, "obsidian_project_todo_filename", "TODO.md"):
        indexer.refresh_index()
        note.write_text("new summary", encoding="utf-8")
        with patch(
            "services.obsidian_vault_indexer.list_project_folders",
            side_effect=AssertionError("full refresh used"),
        ):
            refreshed = indexer.refresh_changed_paths({str(note)})

    assert refreshed.last_incremental_scan > 0
    assert refreshed.projects["Project"].doc_summaries[0]["summary"] == "new summary"


def test_incremental_index_adds_new_project_from_todo_event(tmp_path):
    indexer._index = indexer.VaultIndex()
    with patch.object(indexer.settings, "obsidian_vault_path", str(tmp_path)), \
         patch.object(indexer.settings, "obsidian_cli_command", ""), \
         patch.object(indexer.settings, "obsidian_project_todo_filename", "TODO.md"):
        indexer.refresh_index()
        todo_file = tmp_path / "NewProject" / "TODO.md"
        todo_file.parent.mkdir()
        todo_file.write_text("# New\n", encoding="utf-8")
        refreshed = indexer.refresh_changed_paths({str(todo_file)})

    assert "NewProject" in refreshed.projects


def test_vault_event_filter_ignores_hidden_and_temporary_files(tmp_path):
    assert _is_watchable_vault_path(str(tmp_path), str(tmp_path / "Project" / "TODO.md"))
    assert not _is_watchable_vault_path(
        str(tmp_path), str(tmp_path / ".obsidian" / "workspace.md")
    )
    assert not _is_watchable_vault_path(
        str(tmp_path), str(tmp_path / "Project" / "TODO.md.tmp")
    )
    assert not _is_watchable_vault_path(
        str(tmp_path), str(tmp_path.parent / "outside.md")
    )


@pytest.mark.asyncio
async def test_vault_scan_reads_files_off_the_event_loop_thread(db_session, tmp_path):
    """Vault disk I/O must be offloaded, or a big scan stalls SSE/WebSocket traffic."""
    todo = Todo(title="Offloaded")
    db_session.add(todo)
    await db_session.commit()

    todo_file = tmp_path / "Project" / "TODO.md"
    todo_file.parent.mkdir()
    todo_file.write_text(f"- [x] Offloaded <!-- claw:{todo.id} -->\n", encoding="utf-8")
    watcher._file_hashes.clear()

    loop_thread = threading.current_thread()
    worker_threads: list[threading.Thread] = []
    real_walk = watcher._todo_files_for_scan
    real_read = watcher._read_markers

    def spy_walk(*args, **kwargs):
        worker_threads.append(threading.current_thread())
        return real_walk(*args, **kwargs)

    def spy_read(*args, **kwargs):
        worker_threads.append(threading.current_thread())
        return real_read(*args, **kwargs)

    with patch.object(watcher.settings, "obsidian_vault_path", str(tmp_path)), \
         patch.object(watcher.settings, "obsidian_project_todo_filename", "TODO.md"), \
         patch.object(watcher, "_todo_files_for_scan", spy_walk), \
         patch.object(watcher, "_read_markers", spy_read):
        result = await watcher.scan_vault(db_session)

    assert result.files_scanned == 1
    assert result.markers_found == 1
    assert len(worker_threads) == 2
    assert all(thread is not loop_thread for thread in worker_threads)

    await db_session.refresh(todo)
    assert todo.status == "completed"
