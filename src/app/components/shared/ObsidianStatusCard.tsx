import { useState } from 'react';
import {
  useObsidianHealthQuery,
  useObsidianSync,
  useObsidianReindex,
  useObsidianScan,
  useObsidianFlushQueue,
  useObsidianRetryDeadLetter,
} from '../../hooks/queries/useObsidianQueries';
import { useToastStore } from '../../stores/useToastStore';
import SettingsRow from './SettingsRow';

/**
 * Obsidian vault status card for the Settings page.
 *
 * Shows: vault connection, CLI availability, companion node status,
 * sync mode, project count, write queue, dead letter queue,
 * CLI errors, stuck scan warnings, and bidirectional sync status.
 * Provides actions: export, reindex, scan, flush queue, retry dead letter.
 */
export default function ObsidianStatusCard() {
  const addToast = useToastStore((s) => s.addToast);
  const { data: health, isLoading } = useObsidianHealthQuery();
  const syncMutation = useObsidianSync();
  const reindexMutation = useObsidianReindex();
  const scanMutation = useObsidianScan();
  const flushMutation = useObsidianFlushQueue();
  const retryDeadLetterMutation = useObsidianRetryDeadLetter();
  const [showErrors, setShowErrors] = useState(false);

  if (isLoading) {
    return (
      <div className="cc-settings-section">
        <div className="cc-settings-section__title">Obsidian Vault</div>
        <SettingsRow label="Status">
          <span style={{ fontSize: 12, opacity: 0.6 }}>Loading...</span>
        </SettingsRow>
      </div>
    );
  }

  if (!health) return null;

  const statusColor = health.vault_available ? 'var(--cc-success)' : 'var(--cc-danger)';
  const statusText = health.vault_available ? 'Connected' : 'Unavailable';

  const companionColor = health.companion_online ? 'var(--cc-success)' : 'var(--cc-warning)';
  const companionText = health.companion_online ? 'Online' : 'Offline';

  const syncLag = health.bidirectional_sync?.sync_lag_seconds;
  const formatLag = (seconds: number | null | undefined) => {
    if (seconds === null || seconds === undefined) return 'Never';
    if (seconds < 60) return `${Math.round(seconds)}s ago`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
    return `${Math.round(seconds / 3600)}h ago`;
  };

  const queueCount = health.write_queue?.pending ?? 0;
  const deadLetterCount = health.dead_letter_count ?? 0;
  const queueAge = health.queue_age_seconds;
  const scanStuck = health.scan_stuck ?? health.bidirectional_sync?.scan_stuck;
  const lastCliError = health.last_cli_error;

  return (
    <div className="cc-settings-section">
      <div className="cc-settings-section__title">Obsidian Vault</div>

      <SettingsRow label="Vault" sublabel={health.vault_path || 'Not configured'}>
        <span style={{ fontSize: 12, color: statusColor, fontWeight: 500 }}>
          {statusText}
        </span>
      </SettingsRow>

      <SettingsRow label="Sync mode" sublabel={health.sync_mode}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>
          {health.project_count} project{health.project_count !== 1 ? 's' : ''}
        </span>
      </SettingsRow>

      <SettingsRow label="CLI" sublabel={health.cli_available ? 'Available' : 'Not available'}>
        <span style={{ fontSize: 12, color: health.cli_available ? 'var(--cc-success)' : 'var(--cc-muted)' }}>
          {health.cli_available ? 'OK' : '--'}
        </span>
      </SettingsRow>

      <SettingsRow label="Companion node">
        <span style={{ fontSize: 12, color: companionColor, fontWeight: 500 }}>
          {companionText}
        </span>
      </SettingsRow>

      {health.is_stale && (
        <SettingsRow label="">
          <span style={{ fontSize: 11, color: 'var(--cc-warning)' }}>
            Index is stale — consider reindexing
          </span>
        </SettingsRow>
      )}

      {health.error && (
        <SettingsRow label="">
          <span style={{ fontSize: 11, color: 'var(--cc-danger)' }}>
            {health.error}
          </span>
        </SettingsRow>
      )}

      {scanStuck && (
        <SettingsRow label="">
          <span style={{ fontSize: 11, color: 'var(--cc-danger)', fontWeight: 500 }}>
            Vault scan appears stuck (running &gt; 5m)
          </span>
        </SettingsRow>
      )}

      <SettingsRow label="Last vault scan">
        <span style={{ fontSize: 12, opacity: 0.7 }}>
          {formatLag(syncLag)}
        </span>
      </SettingsRow>

      {queueCount > 0 && (
        <SettingsRow
          label="Write queue"
          sublabel={`${queueCount} pending${queueAge ? ` · oldest ${formatLag(queueAge)}` : ''}`}
        >
          <button
            type="button"
            className="cc-btn cc-btn--secondary"
            onClick={() => {
              flushMutation.mutate(undefined, {
                onSuccess: (data) =>
                  addToast('success', `Flushed: ${data.succeeded}/${data.processed} succeeded`),
                onError: () => addToast('error', 'Queue flush failed'),
              });
            }}
            disabled={flushMutation.isPending}
            style={{ fontSize: 12, padding: '4px 10px' }}
          >
            {flushMutation.isPending ? 'Flushing...' : 'Flush'}
          </button>
        </SettingsRow>
      )}

      {deadLetterCount > 0 && (
        <SettingsRow
          label="Dead letter"
          sublabel={`${deadLetterCount} failed operation${deadLetterCount !== 1 ? 's' : ''}`}
        >
          <button
            type="button"
            className="cc-btn cc-btn--secondary"
            onClick={() => {
              retryDeadLetterMutation.mutate(undefined, {
                onSuccess: (data) =>
                  addToast('success', `Requeued ${data.requeued} operations`),
                onError: () => addToast('error', 'Retry failed'),
              });
            }}
            disabled={retryDeadLetterMutation.isPending}
            style={{ fontSize: 12, padding: '4px 10px' }}
          >
            {retryDeadLetterMutation.isPending ? 'Retrying...' : 'Retry all'}
          </button>
        </SettingsRow>
      )}

      {lastCliError && (
        <SettingsRow label="Last CLI error">
          <button
            type="button"
            onClick={() => setShowErrors((v) => !v)}
            style={{
              fontSize: 11,
              color: 'var(--cc-danger)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              textDecoration: 'underline',
              padding: 0,
            }}
          >
            {lastCliError.error.slice(0, 60)}{lastCliError.error.length > 60 ? '...' : ''}
            {showErrors ? ' (hide)' : ' (show)'}
          </button>
        </SettingsRow>
      )}

      {showErrors && lastCliError && (
        <SettingsRow label="">
          <div style={{ fontSize: 11, opacity: 0.7, whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto' }}>
            <div>Command: {lastCliError.command}</div>
            <div>Error: {lastCliError.error}</div>
            <div>Code: {lastCliError.returncode ?? 'N/A'}</div>
            <div>Time: {new Date(lastCliError.timestamp * 1000).toLocaleString()}</div>
          </div>
        </SettingsRow>
      )}

      <SettingsRow label="Actions">
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className="cc-btn cc-btn--secondary"
            onClick={() => {
              syncMutation.mutate(undefined, {
                onSuccess: (data) =>
                  addToast('success', `Exported ${data.exported ?? 0} tasks`),
                onError: () => addToast('error', 'Export failed'),
              });
            }}
            disabled={syncMutation.isPending || !health.vault_available}
            style={{ fontSize: 11, padding: '3px 8px' }}
          >
            {syncMutation.isPending ? 'Exporting...' : 'Export'}
          </button>

          <button
            type="button"
            className="cc-btn cc-btn--secondary"
            onClick={() => {
              reindexMutation.mutate(undefined, {
                onSuccess: (data) =>
                  addToast('success', `Indexed ${data.project_count} projects`),
                onError: () => addToast('error', 'Reindex failed'),
              });
            }}
            disabled={reindexMutation.isPending || !health.vault_available}
            style={{ fontSize: 11, padding: '3px 8px' }}
          >
            {reindexMutation.isPending ? 'Indexing...' : 'Reindex'}
          </button>

          <button
            type="button"
            className="cc-btn cc-btn--secondary"
            onClick={() => {
              scanMutation.mutate(undefined, {
                onSuccess: (data) =>
                  addToast(
                    'success',
                    `Scanned ${data.files_scanned} files, ${data.changes_applied} changes applied`,
                  ),
                onError: () => addToast('error', 'Vault scan failed'),
              });
            }}
            disabled={scanMutation.isPending || !health.vault_available}
            style={{ fontSize: 11, padding: '3px 8px' }}
          >
            {scanMutation.isPending ? 'Scanning...' : 'Scan'}
          </button>
        </div>
      </SettingsRow>

      {!health.companion_online && health.vault_available && (
        <SettingsRow label="">
          <span style={{ fontSize: 11, color: 'var(--cc-warning)', fontStyle: 'italic' }}>
            Companion node offline — writes will be queued
          </span>
        </SettingsRow>
      )}
    </div>
  );
}
