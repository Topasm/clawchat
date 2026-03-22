"""Unit tests for obsidian_cli_service — CLI wrapper, path normalization,
write queue, dead letter queue, and exponential backoff.

Uses mocked subprocess to avoid needing an actual Obsidian CLI binary.
"""

import json
import os
import time
from unittest.mock import MagicMock, patch

import pytest

# Override settings before importing the service
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("JWT_SECRET", "test")
os.environ.setdefault("PIN", "123456")

from services import obsidian_cli_service as svc  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _reset_state():
    """Clear all module-level state between tests."""
    svc._write_queue.clear()
    svc._dead_letter_queue.clear()
    svc._cli_error_log.clear()
    svc._last_successful_cli_at = 0.0


@pytest.fixture(autouse=True)
def clean_state():
    _reset_state()
    yield
    _reset_state()


def _make_proc(returncode=0, stdout="", stderr=""):
    """Build a mock CompletedProcess."""
    proc = MagicMock()
    proc.returncode = returncode
    proc.stdout = stdout
    proc.stderr = stderr
    return proc


# ---------------------------------------------------------------------------
# Path normalization
# ---------------------------------------------------------------------------


class TestNormalizeVaultPath:
    def test_strips_leading_slash(self):
        assert svc._normalize_vault_path("/Projects/foo.md") == "Projects/foo.md"

    def test_normalizes_backslashes(self):
        assert svc._normalize_vault_path("Projects\\sub\\foo.md") == "Projects/sub/foo.md"

    def test_rejects_traversal(self):
        with pytest.raises(ValueError, match="traversal"):
            svc._normalize_vault_path("../../etc/passwd")

    def test_rejects_midpath_traversal(self):
        with pytest.raises(ValueError, match="traversal"):
            svc._normalize_vault_path("Projects/../secret/file.md")

    def test_passthrough_normal_path(self):
        assert svc._normalize_vault_path("Projects/work/TODO.md") == "Projects/work/TODO.md"

    def test_strips_multiple_leading_slashes(self):
        assert svc._normalize_vault_path("///foo.md") == "foo.md"


# ---------------------------------------------------------------------------
# Sync mode
# ---------------------------------------------------------------------------


class TestSyncMode:
    @patch.object(svc.settings, "obsidian_sync_mode", "disabled")
    def test_create_document_noop_when_disabled(self, tmp_path):
        with patch.object(svc.settings, "obsidian_vault_path", str(tmp_path)):
            result = svc.create_document("test.md", "content")
        assert result is False
        # File should not be created
        assert not (tmp_path / "test.md").exists()

    @patch.object(svc.settings, "obsidian_sync_mode", "filesystem")
    def test_create_document_works_when_filesystem(self, tmp_path):
        with patch.object(svc.settings, "obsidian_vault_path", str(tmp_path)):
            with patch.object(svc.settings, "obsidian_cli_command", ""):
                result = svc.create_document("test.md", "hello")
        assert result is True
        assert (tmp_path / "test.md").read_text() == "hello"


# ---------------------------------------------------------------------------
# CLI create/append
# ---------------------------------------------------------------------------


class TestCreateDocument:
    @patch.object(svc.settings, "obsidian_sync_mode", "filesystem")
    @patch.object(svc.settings, "obsidian_cli_command", "/usr/bin/obsidian")
    def test_cli_success(self, tmp_path):
        with patch.object(svc.settings, "obsidian_vault_path", str(tmp_path)):
            with patch("services.obsidian_cli_service.subprocess.run", return_value=_make_proc()):
                result = svc.create_document("notes/test.md", "content")
        assert result is True

    @patch.object(svc.settings, "obsidian_sync_mode", "filesystem")
    @patch.object(svc.settings, "obsidian_cli_command", "/usr/bin/obsidian")
    def test_cli_fail_filesystem_fallback(self, tmp_path):
        with patch.object(svc.settings, "obsidian_vault_path", str(tmp_path)):
            with patch("services.obsidian_cli_service.subprocess.run", return_value=_make_proc(returncode=1, stderr="fail")):
                result = svc.create_document("notes/test.md", "content")
        assert result is True
        assert (tmp_path / "notes" / "test.md").read_text() == "content"

    @patch.object(svc.settings, "obsidian_sync_mode", "filesystem")
    @patch.object(svc.settings, "obsidian_cli_command", "")
    def test_no_cli_filesystem_only(self, tmp_path):
        with patch.object(svc.settings, "obsidian_vault_path", str(tmp_path)):
            result = svc.create_document("test.md", "hello")
        assert result is True
        assert (tmp_path / "test.md").read_text() == "hello"


class TestAppendDocument:
    @patch.object(svc.settings, "obsidian_sync_mode", "filesystem")
    @patch.object(svc.settings, "obsidian_cli_command", "")
    def test_append_creates_file_if_missing(self, tmp_path):
        with patch.object(svc.settings, "obsidian_vault_path", str(tmp_path)):
            result = svc.append_to_document("test.md", "line1\n")
        assert result is True
        assert (tmp_path / "test.md").read_text() == "line1\n"

    @patch.object(svc.settings, "obsidian_sync_mode", "filesystem")
    @patch.object(svc.settings, "obsidian_cli_command", "")
    def test_append_adds_to_existing(self, tmp_path):
        (tmp_path / "test.md").write_text("existing\n")
        with patch.object(svc.settings, "obsidian_vault_path", str(tmp_path)):
            svc.append_to_document("test.md", "added\n")
        assert (tmp_path / "test.md").read_text() == "existing\nadded\n"


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------


class TestSearchVault:
    @patch.object(svc.settings, "obsidian_cli_command", "")
    def test_filesystem_search_by_filename(self, tmp_path):
        (tmp_path / "notes").mkdir()
        (tmp_path / "notes" / "meeting.md").write_text("# Meeting")
        (tmp_path / "notes" / "todo.md").write_text("# Todo")
        with patch.object(svc.settings, "obsidian_vault_path", str(tmp_path)):
            results = svc.search_vault("meeting")
        assert len(results) == 1
        assert "meeting.md" in results[0]["path"]


# ---------------------------------------------------------------------------
# Write queue
# ---------------------------------------------------------------------------


class TestWriteQueue:
    def test_queue_status_empty(self):
        status = svc.get_queue_status()
        assert status["pending"] == 0
        assert status["oldest_age_seconds"] is None

    def test_enqueue_and_status(self):
        svc._enqueue(svc.WriteOp(op="create", args={"path": "test.md"}, queued_at=time.time()))
        status = svc.get_queue_status()
        assert status["pending"] == 1

    @patch.object(svc.settings, "obsidian_sync_mode", "filesystem")
    @patch.object(svc.settings, "obsidian_cli_command", "")
    def test_flush_queue_success(self, tmp_path):
        with patch.object(svc.settings, "obsidian_vault_path", str(tmp_path)):
            svc._enqueue(svc.WriteOp(
                op="create",
                args={"path": "test.md", "content": "hello"},
                queued_at=time.time(),
            ))
            result = svc.flush_queue()
        assert result["succeeded"] == 1
        assert result["failed"] == 0
        assert svc.get_queue_status()["pending"] == 0

    def test_flush_queue_failure_increments_retries(self):
        svc._enqueue(svc.WriteOp(
            op="create",
            args={"path": "test.md", "content": "hello"},
            queued_at=time.time(),
        ))
        with patch.object(svc.settings, "obsidian_sync_mode", "disabled"):
            result = svc.flush_queue()
        # Disabled mode returns False from create_document
        assert result["failed"] == 1
        assert svc._write_queue[0].retries == 1

    def test_clear_queue(self):
        svc._enqueue(svc.WriteOp(op="create", args={"path": "x.md"}, queued_at=time.time()))
        cleared = svc.clear_queue()
        assert cleared == 1
        assert svc.get_queue_status()["pending"] == 0


# ---------------------------------------------------------------------------
# Dead letter queue
# ---------------------------------------------------------------------------


class TestDeadLetter:
    def test_max_retries_moves_to_dead_letter(self):
        op = svc.WriteOp(
            op="create",
            args={"path": "fail.md", "content": "x"},
            queued_at=time.time() - 10000,  # old enough to bypass backoff
            retries=svc.MAX_RETRIES,
        )
        svc._write_queue.append(op)
        result = svc.flush_queue()
        assert result["dead_lettered"] == 1
        assert svc.get_queue_status()["pending"] == 0
        assert svc.get_dead_letter_status()["count"] == 1

    def test_retry_dead_letter_requeues(self):
        svc._dead_letter_queue.append(svc.WriteOp(
            op="create", args={"path": "x.md"}, queued_at=1.0, retries=10,
        ))
        requeued = svc.retry_dead_letter()
        assert requeued == 1
        assert svc.get_dead_letter_status()["count"] == 0
        assert svc.get_queue_status()["pending"] == 1
        # Retries should be reset
        assert svc._write_queue[0].retries == 0

    def test_clear_dead_letter(self):
        svc._dead_letter_queue.append(svc.WriteOp(
            op="create", args={"path": "x.md"}, queued_at=1.0, retries=10,
        ))
        cleared = svc.clear_dead_letter()
        assert cleared == 1
        assert svc.get_dead_letter_status()["count"] == 0


# ---------------------------------------------------------------------------
# Exponential backoff
# ---------------------------------------------------------------------------


class TestBackoff:
    def test_skips_recently_failed_ops(self):
        """Ops with retries > 0 whose backoff hasn't elapsed should be skipped."""
        op = svc.WriteOp(
            op="create",
            args={"path": "test.md", "content": "x"},
            queued_at=time.time(),  # Just now — backoff not elapsed
            retries=3,
        )
        svc._write_queue.append(op)
        result = svc.flush_queue()
        # Should be skipped (still in queue, not processed)
        assert result["processed"] == 0
        assert svc.get_queue_status()["pending"] == 1
        assert svc._write_queue[0].retries == 3  # Unchanged


# ---------------------------------------------------------------------------
# Queue persistence
# ---------------------------------------------------------------------------


class TestQueuePersistence:
    def test_roundtrip_save_load(self, tmp_path):
        queue_file = str(tmp_path / "queue.json")
        dead_file = str(tmp_path / "dead.json")

        with patch.object(svc, "_QUEUE_FILE", queue_file), \
             patch.object(svc, "_DEAD_LETTER_FILE", dead_file):
            svc._write_queue.append(svc.WriteOp(
                op="create", args={"path": "a.md", "content": "hello"},
                queued_at=123.0, retries=2, error="some error",
            ))
            svc._dead_letter_queue.append(svc.WriteOp(
                op="append", args={"path": "b.md", "content": "world"},
                queued_at=456.0, retries=10, error="max retries",
            ))
            svc._persist_queue()

            # Clear and reload
            svc._write_queue.clear()
            svc._dead_letter_queue.clear()
            svc.load_queue()

        assert len(svc._write_queue) == 1
        assert svc._write_queue[0].op == "create"
        assert svc._write_queue[0].retries == 2
        assert len(svc._dead_letter_queue) == 1
        assert svc._dead_letter_queue[0].op == "append"
        assert svc._dead_letter_queue[0].retries == 10


# ---------------------------------------------------------------------------
# CLI error tracking
# ---------------------------------------------------------------------------


class TestCliErrorLog:
    @patch.object(svc.settings, "obsidian_cli_command", "/usr/bin/obsidian")
    @patch.object(svc.settings, "obsidian_vault_path", "/tmp/vault")
    def test_failed_cli_logs_error(self):
        with patch("services.obsidian_cli_service.subprocess.run",
                   return_value=_make_proc(returncode=1, stderr="bad args")):
            result = svc._run_cli("create", "path=test.md")
        assert result is None
        errors = svc.get_cli_error_log()
        assert len(errors) == 1
        assert errors[0]["error"] == "bad args"
        assert errors[0]["returncode"] == 1

    @patch.object(svc.settings, "obsidian_cli_command", "/usr/bin/obsidian")
    @patch.object(svc.settings, "obsidian_vault_path", "/tmp/vault")
    def test_successful_cli_updates_timestamp(self):
        with patch("services.obsidian_cli_service.subprocess.run",
                   return_value=_make_proc(stdout="v1.0")):
            result = svc._run_cli("version")
        assert result is not None
        assert svc.get_last_successful_cli_at() > 0

    @patch.object(svc.settings, "obsidian_cli_command", "/nonexistent")
    @patch.object(svc.settings, "obsidian_vault_path", "/tmp/vault")
    def test_cli_not_found_logs_error(self):
        with patch("services.obsidian_cli_service.subprocess.run",
                   side_effect=FileNotFoundError("not found")):
            result = svc._run_cli("version")
        assert result is None
        errors = svc.get_cli_error_log()
        assert len(errors) == 1
        assert "not found" in errors[0]["error"]
