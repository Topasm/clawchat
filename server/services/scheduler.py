"""Background asyncio scheduler for reminders, briefings, and maintenance."""

import asyncio
import logging
import os
from datetime import datetime, time, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from config import settings
from services import briefing_service, reminder_service, nudge_service, weekly_review_service
from services.ai_service import AIService
from ws.manager import ConnectionManager

# Lazy imports for optional vault services
_vault_services_loaded = False

logger = logging.getLogger(__name__)

# Default user ID for single-user app
DEFAULT_USER_ID = "default"
_VAULT_FULL_AUDIT_SECONDS = 60 * 60


def _is_watchable_vault_path(vault_path: str, path: str) -> bool:
    """Filter hidden, temporary, and unrelated filesystem events."""
    relative = os.path.relpath(path, vault_path)
    if relative == os.pardir or relative.startswith(f"{os.pardir}{os.sep}"):
        return False
    parts = relative.split(os.sep)
    if any(part.startswith(".") for part in parts):
        return False
    filename = parts[-1]
    if filename.startswith((".#", "~")) or filename.endswith(
        ("~", ".tmp", ".swp", ".swx")
    ):
        return False
    return os.path.isdir(path) or filename.endswith(".md") or "." not in filename


def _parse_quiet_hours(quiet_str: str) -> tuple[int, int]:
    """Parse 'HH:MM-HH:MM' quiet hours string into (start_hour, end_hour)."""
    try:
        parts = quiet_str.split("-")
        start = int(parts[0].split(":")[0])
        end = int(parts[1].split(":")[0])
        return start, end
    except (ValueError, IndexError):
        return 22, 7  # default: 10pm-7am


def _in_quiet_hours(hour: int, quiet_start: int, quiet_end: int) -> bool:
    """Check if the given hour falls within quiet hours (handles midnight wrap)."""
    if quiet_start > quiet_end:
        # Wraps midnight (e.g., 22-07)
        return hour >= quiet_start or hour < quiet_end
    return quiet_start <= hour < quiet_end


class Scheduler:
    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        ai_service: AIService,
        ws_manager: ConnectionManager,
        push_service=None,
    ):
        self.session_factory = session_factory
        self.ai_service = ai_service
        self.ws_manager = ws_manager
        self.push_service = push_service
        self._tasks: list[asyncio.Task] = []

    def start(self) -> None:
        self._tasks = [
            asyncio.create_task(self._reminder_loop(), name="scheduler-reminders"),
            asyncio.create_task(self._briefing_loop(), name="scheduler-briefing"),
            asyncio.create_task(self._midnight_reset_loop(), name="scheduler-midnight"),
        ]

        # Weekly review loop
        if settings.enable_weekly_review:
            self._tasks.append(
                asyncio.create_task(self._weekly_review_loop(), name="scheduler-weekly-review")
            )

        # Nudge loop (proactive task reminders)
        if settings.enable_nudges:
            self._tasks.append(
                asyncio.create_task(self._nudge_loop(), name="scheduler-nudges")
            )

        # Vault integration tasks (only if watch explicitly enabled, vault configured, and sync not disabled)
        if (
            settings.obsidian_watch_enabled
            and settings.obsidian_vault_path
            and settings.obsidian_sync_mode != "disabled"
        ):
            self._tasks.append(
                asyncio.create_task(self._vault_scan_loop(), name="scheduler-vault-scan")
            )
            self._tasks.append(
                asyncio.create_task(self._vault_queue_flush_loop(), name="scheduler-vault-queue")
            )

        logger.info("Scheduler started with %d background tasks", len(self._tasks))

    async def stop(self) -> None:
        for task in self._tasks:
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()
        logger.info("Scheduler stopped")

    async def _reminder_loop(self) -> None:
        interval = settings.reminder_check_interval * 60  # minutes → seconds
        logger.info("Reminder loop started (interval: %ds)", interval)
        try:
            while True:
                try:
                    async with self.session_factory() as db:
                        sent = await reminder_service.run_all_checks(
                            db, self.ws_manager, DEFAULT_USER_ID,
                            push_service=self.push_service,
                        )
                        if sent:
                            logger.info("Sent %d reminder(s)", sent)
                except Exception:
                    logger.exception("Error in reminder loop")
                await asyncio.sleep(interval)
        except asyncio.CancelledError:
            logger.debug("Reminder loop cancelled")

    async def _briefing_loop(self) -> None:
        logger.info("Briefing loop started (target: %s UTC)", settings.briefing_time)
        try:
            while True:
                now = datetime.now(timezone.utc)
                # Parse briefing_time setting (HH:MM)
                parts = settings.briefing_time.split(":")
                target_time = time(int(parts[0]), int(parts[1]), tzinfo=timezone.utc)
                target = datetime.combine(now.date(), target_time)

                if target <= now:
                    # Already past today's briefing time, schedule for tomorrow
                    target = datetime.combine(
                        now.date() + timedelta(days=1), target_time
                    )

                sleep_seconds = (target - now).total_seconds()
                logger.debug("Briefing scheduled in %.0fs", sleep_seconds)
                await asyncio.sleep(sleep_seconds)

                try:
                    async with self.session_factory() as db:
                        content = await briefing_service.generate_briefing(
                            db, self.ai_service
                        )
                        await self.ws_manager.send_json(DEFAULT_USER_ID, {
                            "type": "daily_briefing",
                            "data": {
                                "content": content,
                                "generated_at": datetime.now(timezone.utc).isoformat(),
                            },
                        })
                        logger.info("Daily briefing sent")
                except Exception:
                    logger.exception("Error generating daily briefing")
        except asyncio.CancelledError:
            logger.debug("Briefing loop cancelled")

    async def _midnight_reset_loop(self) -> None:
        logger.info("Midnight reset loop started")
        try:
            while True:
                now = datetime.now(timezone.utc)
                tomorrow = datetime.combine(
                    now.date() + timedelta(days=1),
                    time.min,
                    tzinfo=timezone.utc,
                )
                sleep_seconds = (tomorrow - now).total_seconds()
                await asyncio.sleep(sleep_seconds)

                reminder_service.clear_sent_reminders()
                logger.info("Midnight: cleared reminder dedup set")
        except asyncio.CancelledError:
            logger.debug("Midnight reset loop cancelled")

    async def _weekly_review_loop(self) -> None:
        """Run weekly on configured day/time to generate a GTD review."""
        logger.info(
            "Weekly review loop started (day: %s, time: %s UTC)",
            settings.weekly_review_day,
            settings.weekly_review_time,
        )
        day_names = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
        target_weekday = 6  # default sunday
        if settings.weekly_review_day.lower() in day_names:
            target_weekday = day_names.index(settings.weekly_review_day.lower())

        parts = settings.weekly_review_time.split(":")
        target_hour = int(parts[0]) if parts else 9
        target_minute = int(parts[1]) if len(parts) > 1 else 0

        try:
            while True:
                now = datetime.now(timezone.utc)
                # Calculate next target day/time
                days_ahead = (target_weekday - now.weekday()) % 7
                if days_ahead == 0:
                    target = now.replace(hour=target_hour, minute=target_minute, second=0, microsecond=0)
                    if target <= now:
                        days_ahead = 7
                        target += timedelta(days=7)
                else:
                    target = (now + timedelta(days=days_ahead)).replace(
                        hour=target_hour, minute=target_minute, second=0, microsecond=0
                    )

                sleep_seconds = (target - now).total_seconds()
                logger.debug("Weekly review scheduled in %.0fs", sleep_seconds)
                await asyncio.sleep(sleep_seconds)

                try:
                    async with self.session_factory() as db:
                        review = await weekly_review_service.generate_weekly_review(
                            db, self.ai_service
                        )
                        await self.ws_manager.send_json(DEFAULT_USER_ID, {
                            "type": "weekly_review",
                            "data": review,
                        })
                        logger.info("Weekly review sent")
                except Exception:
                    logger.exception("Error generating weekly review")
        except asyncio.CancelledError:
            logger.debug("Weekly review loop cancelled")

    async def _nudge_loop(self) -> None:
        """Periodically check for stale/forgotten tasks and send AI-generated nudges."""
        interval = settings.nudge_interval_hours * 3600
        logger.info("Nudge loop started (interval: %ds)", interval)
        try:
            while True:
                try:
                    now = datetime.now(timezone.utc)
                    hour = now.hour

                    # Respect quiet hours (e.g., "22:00-07:00")
                    quiet_start, quiet_end = _parse_quiet_hours(settings.nudge_quiet_hours)
                    if _in_quiet_hours(hour, quiet_start, quiet_end):
                        logger.debug("Nudge skipped: quiet hours (%02d:00-%02d:00)", quiet_start, quiet_end)
                    else:
                        async with self.session_factory() as db:
                            candidates = await nudge_service.find_nudge_candidates(db)
                            if candidates:
                                nudge = await nudge_service.generate_nudge(
                                    candidates, self.ai_service
                                )
                                if nudge:
                                    await self.ws_manager.send_json(DEFAULT_USER_ID, {
                                        "type": "nudge",
                                        "data": nudge,
                                    })
                                    logger.info("Sent nudge for todo: %s", nudge.get("todo_id"))
                except Exception:
                    logger.exception("Error in nudge loop")
                await asyncio.sleep(interval)
        except asyncio.CancelledError:
            logger.debug("Nudge loop cancelled")

    async def _vault_scan_loop(self) -> None:
        """Process real-time vault events with periodic full audit fallback."""
        interval = settings.obsidian_scan_interval_minutes * 60
        vault_path = settings.obsidian_vault_path
        logger.info(
            "Vault watcher started (poll fallback: %ds, full audit: %ds)",
            interval,
            _VAULT_FULL_AUDIT_SECONDS,
        )

        try:
            from services.obsidian_vault_indexer import refresh_index
            from services.vault_watcher_service import scan_vault

            await asyncio.to_thread(refresh_index)
            async with self.session_factory() as db:
                await scan_vault(db)
            logger.info("Initial vault index built")
        except Exception:
            logger.exception("Failed to initialize vault watcher")

        try:
            from watchfiles import awatch

            audit_task = asyncio.create_task(
                self._vault_full_audit_loop(), name="scheduler-vault-full-audit"
            )
            try:
                async for changes in awatch(vault_path, debounce=500, step=100):
                    changed_paths = {
                        path
                        for _change, path in changes
                        if _is_watchable_vault_path(vault_path, path)
                    }
                    if changed_paths:
                        try:
                            await self._sync_changed_vault_paths(changed_paths)
                        except Exception:
                            logger.exception("Failed to process vault change batch")
            finally:
                audit_task.cancel()
                await asyncio.gather(audit_task, return_exceptions=True)
        except ImportError:
            logger.warning("watchfiles unavailable; using periodic vault scan")
            await self._vault_poll_loop(interval)
        except OSError:
            logger.exception("Vault event watcher failed; using periodic scan")
            await self._vault_poll_loop(interval)
        except asyncio.CancelledError:
            logger.debug("Vault watcher cancelled")
        except Exception:
            logger.exception("Vault event watcher stopped; using periodic scan")
            await self._vault_poll_loop(interval)

    async def _sync_changed_vault_paths(self, changed_paths: set[str]) -> None:
        from services.obsidian_vault_indexer import refresh_changed_paths
        from services.vault_watcher_service import scan_vault

        async with self.session_factory() as db:
            result = await scan_vault(db, changed_paths)
            if result.changes_applied:
                logger.info(
                    "Incremental vault scan: %d changes applied",
                    result.changes_applied,
                )
        await asyncio.to_thread(refresh_changed_paths, changed_paths)

    async def _vault_full_audit_loop(self) -> None:
        from services.obsidian_vault_indexer import refresh_index
        from services.vault_watcher_service import scan_vault

        try:
            while True:
                await asyncio.sleep(_VAULT_FULL_AUDIT_SECONDS)
                try:
                    async with self.session_factory() as db:
                        await scan_vault(db)
                    await asyncio.to_thread(refresh_index)
                except Exception:
                    logger.exception("Error in vault full audit")
        except asyncio.CancelledError:
            logger.debug("Vault full audit loop cancelled")

    async def _vault_poll_loop(self, interval: int) -> None:
        from services.obsidian_vault_indexer import refresh_index
        from services.vault_watcher_service import scan_vault

        try:
            while True:
                await asyncio.sleep(interval)
                try:
                    async with self.session_factory() as db:
                        await scan_vault(db)
                    await asyncio.to_thread(refresh_index)
                except Exception:
                    logger.exception("Error in periodic vault scan")
        except asyncio.CancelledError:
            logger.debug("Periodic vault scan cancelled")

    async def _vault_queue_flush_loop(self) -> None:
        """Periodically attempt to flush the write queue."""
        logger.info("Vault queue flush loop started (interval: 60s)")
        try:
            while True:
                await asyncio.sleep(60)
                try:
                    from services.obsidian_cli_service import flush_queue, get_queue_status

                    status = get_queue_status()
                    if status["pending"] > 0:
                        result = flush_queue()
                        if result["succeeded"]:
                            logger.info(
                                "Queue flush: %d/%d succeeded",
                                result["succeeded"],
                                result["processed"],
                            )
                except Exception:
                    logger.exception("Error in queue flush loop")
        except asyncio.CancelledError:
            logger.debug("Vault queue flush loop cancelled")
