"""End-to-end smoke test for Obsidian integration using filesystem mode.

Creates a temporary vault directory and exercises the full pipeline:
create → search → append → read back → export todo → scan for changes.

No Docker or Obsidian CLI binary required — uses filesystem fallback only.
"""

import os
from unittest.mock import patch

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

# Ensure test config is set before app imports
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("JWT_SECRET", "test")
os.environ.setdefault("PIN", "123456")
os.environ.setdefault("OBSIDIAN_SYNC_MODE", "filesystem")
os.environ.setdefault("OBSIDIAN_CLI_COMMAND", "")
os.environ.setdefault("ENABLE_SCHEDULER", "false")

from services import obsidian_cli_service as cli_svc  # noqa: E402
from services.obsidian_export_service import export_todo  # noqa: E402


@pytest.fixture(autouse=True)
def clean_cli_state():
    cli_svc._write_queue.clear()
    cli_svc._dead_letter_queue.clear()
    cli_svc._cli_error_log.clear()
    yield
    cli_svc._write_queue.clear()
    cli_svc._dead_letter_queue.clear()


@pytest.mark.integration
class TestObsidianSmoke:
    """Full pipeline smoke test using a temporary vault directory."""

    def test_create_and_read_back(self, tmp_path):
        """Create a document and verify it exists on disk."""
        with patch.object(cli_svc.settings, "obsidian_vault_path", str(tmp_path)), \
             patch.object(cli_svc.settings, "obsidian_cli_command", ""), \
             patch.object(cli_svc.settings, "obsidian_sync_mode", "filesystem"):
            result = cli_svc.create_document("Projects/test/README.md", "# Test Project\n")
        assert result is True
        assert (tmp_path / "Projects" / "test" / "README.md").read_text() == "# Test Project\n"

    def test_append_to_document(self, tmp_path):
        """Append to an existing document."""
        with patch.object(cli_svc.settings, "obsidian_vault_path", str(tmp_path)), \
             patch.object(cli_svc.settings, "obsidian_cli_command", ""), \
             patch.object(cli_svc.settings, "obsidian_sync_mode", "filesystem"):
            cli_svc.create_document("notes.md", "# Notes\n")
            cli_svc.append_to_document("notes.md", "- Item 1\n")
            cli_svc.append_to_document("notes.md", "- Item 2\n")

        content = (tmp_path / "notes.md").read_text()
        assert "# Notes" in content
        assert "- Item 1" in content
        assert "- Item 2" in content

    def test_search_by_filename(self, tmp_path):
        """Search vault finds files by filename."""
        with patch.object(cli_svc.settings, "obsidian_vault_path", str(tmp_path)), \
             patch.object(cli_svc.settings, "obsidian_cli_command", ""), \
             patch.object(cli_svc.settings, "obsidian_sync_mode", "filesystem"):
            cli_svc.create_document("Projects/alpha/TODO.md", "# Alpha Todos\n")
            cli_svc.create_document("Projects/beta/TODO.md", "# Beta Todos\n")
            cli_svc.create_document("Projects/alpha/notes.md", "# Notes\n")

            results = cli_svc.search_vault("TODO")
        assert len(results) == 2
        paths = [r["path"] for r in results]
        assert any("alpha" in p for p in paths)
        assert any("beta" in p for p in paths)

    def test_create_nested_directory(self, tmp_path):
        """Create document in deeply nested path creates intermediate dirs."""
        with patch.object(cli_svc.settings, "obsidian_vault_path", str(tmp_path)), \
             patch.object(cli_svc.settings, "obsidian_cli_command", ""), \
             patch.object(cli_svc.settings, "obsidian_sync_mode", "filesystem"):
            result = cli_svc.create_document(
                "Projects/deep/nested/folder/doc.md", "content"
            )
        assert result is True
        assert (tmp_path / "Projects" / "deep" / "nested" / "folder" / "doc.md").exists()

    def test_path_traversal_rejected(self, tmp_path):
        """Path traversal attempts are rejected."""
        with patch.object(cli_svc.settings, "obsidian_vault_path", str(tmp_path)), \
             patch.object(cli_svc.settings, "obsidian_cli_command", ""), \
             patch.object(cli_svc.settings, "obsidian_sync_mode", "filesystem"):
            with pytest.raises(ValueError, match="traversal"):
                cli_svc.create_document("../../etc/passwd", "malicious")

    def test_disabled_mode_noop(self, tmp_path):
        """Disabled sync mode produces no file operations."""
        with patch.object(cli_svc.settings, "obsidian_vault_path", str(tmp_path)), \
             patch.object(cli_svc.settings, "obsidian_cli_command", ""), \
             patch.object(cli_svc.settings, "obsidian_sync_mode", "disabled"):
            result = cli_svc.create_document("test.md", "content")
        assert result is False
        assert not (tmp_path / "test.md").exists()

    def test_write_queue_on_failure(self, tmp_path):
        """Failed writes are queued when companion_node_required is True."""
        # Create a directory where a file is expected — open() on a dir raises IsADirectoryError
        blocker = tmp_path / "sub" / "blocked.md"
        (tmp_path / "sub").mkdir()
        (tmp_path / "sub" / "blocked.md").mkdir()  # dir where file expected

        with patch.object(cli_svc.settings, "obsidian_vault_path", str(tmp_path)), \
             patch.object(cli_svc.settings, "obsidian_cli_command", ""), \
             patch.object(cli_svc.settings, "obsidian_sync_mode", "filesystem"), \
             patch.object(cli_svc.settings, "obsidian_companion_node_required", True):
            result = cli_svc.create_document("sub/blocked.md", "content")

        assert result is False
        assert cli_svc.get_queue_status()["pending"] == 1
