"""Obsidian vault integration, both directions.

Read side: ``obsidian_context_service`` (project context),
``obsidian_vault_indexer`` (cached folder map).  Write side:
``obsidian_export_service`` (todo markdown), ``obsidian_cli_service`` (CLI
wrapper plus the offline write queue).  Sync side: ``vault_watcher_service``
(external edits back into the DB) and ``vault_sync_service`` (durable
post-commit reconciliation jobs).

Self-contained -- imports nothing else under ``services``.
"""
