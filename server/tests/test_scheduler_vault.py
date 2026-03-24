"""Test that vault scan loop respects OBSIDIAN_WATCH_ENABLED setting."""

import asyncio
from unittest.mock import MagicMock, patch

import pytest
import pytest_asyncio

from services.scheduler import Scheduler


def _make_scheduler(**overrides):
    """Build a Scheduler with mock dependencies."""
    return Scheduler(
        session_factory=overrides.get("session_factory", MagicMock()),
        ai_service=overrides.get("ai_service", MagicMock()),
        ws_manager=overrides.get("ws_manager", MagicMock()),
    )


class TestVaultScanGating:
    """Verify that _vault_scan_loop and _vault_queue_flush_loop only start
    when obsidian_watch_enabled is True."""

    @pytest.mark.asyncio
    @patch("services.scheduler.settings")
    async def test_watch_disabled_no_vault_tasks(self, mock_settings):
        """With watch_enabled=False, no vault tasks should be created."""
        mock_settings.enable_weekly_review = False
        mock_settings.enable_nudges = False
        mock_settings.obsidian_watch_enabled = False
        mock_settings.obsidian_vault_path = "/vault"
        mock_settings.obsidian_sync_mode = "filesystem"
        mock_settings.reminder_check_interval = 5
        mock_settings.briefing_time = "08:00"

        scheduler = _make_scheduler()
        scheduler.start()

        task_names = [t.get_name() for t in scheduler._tasks]
        assert "scheduler-vault-scan" not in task_names
        assert "scheduler-vault-queue" not in task_names

        await scheduler.stop()

    @pytest.mark.asyncio
    @patch("services.scheduler.settings")
    async def test_watch_enabled_starts_vault_tasks(self, mock_settings):
        """With watch_enabled=True, vault path set, and sync not disabled,
        vault tasks should be created."""
        mock_settings.enable_weekly_review = False
        mock_settings.enable_nudges = False
        mock_settings.obsidian_watch_enabled = True
        mock_settings.obsidian_vault_path = "/vault"
        mock_settings.obsidian_sync_mode = "filesystem"
        mock_settings.obsidian_scan_interval_minutes = 5
        mock_settings.reminder_check_interval = 5
        mock_settings.briefing_time = "08:00"

        scheduler = _make_scheduler()
        scheduler.start()

        task_names = [t.get_name() for t in scheduler._tasks]
        assert "scheduler-vault-scan" in task_names
        assert "scheduler-vault-queue" in task_names

        await scheduler.stop()

    @pytest.mark.asyncio
    @patch("services.scheduler.settings")
    async def test_watch_enabled_but_sync_disabled(self, mock_settings):
        """Even with watch_enabled=True, sync_mode=disabled should skip vault tasks."""
        mock_settings.enable_weekly_review = False
        mock_settings.enable_nudges = False
        mock_settings.obsidian_watch_enabled = True
        mock_settings.obsidian_vault_path = "/vault"
        mock_settings.obsidian_sync_mode = "disabled"
        mock_settings.reminder_check_interval = 5
        mock_settings.briefing_time = "08:00"

        scheduler = _make_scheduler()
        scheduler.start()

        task_names = [t.get_name() for t in scheduler._tasks]
        assert "scheduler-vault-scan" not in task_names
        assert "scheduler-vault-queue" not in task_names

        await scheduler.stop()

    @pytest.mark.asyncio
    @patch("services.scheduler.settings")
    async def test_watch_enabled_but_no_vault_path(self, mock_settings):
        """With watch_enabled=True but no vault path, skip vault tasks."""
        mock_settings.enable_weekly_review = False
        mock_settings.enable_nudges = False
        mock_settings.obsidian_watch_enabled = True
        mock_settings.obsidian_vault_path = ""
        mock_settings.obsidian_sync_mode = "filesystem"
        mock_settings.reminder_check_interval = 5
        mock_settings.briefing_time = "08:00"

        scheduler = _make_scheduler()
        scheduler.start()

        task_names = [t.get_name() for t in scheduler._tasks]
        assert "scheduler-vault-scan" not in task_names
        assert "scheduler-vault-queue" not in task_names

        await scheduler.stop()
