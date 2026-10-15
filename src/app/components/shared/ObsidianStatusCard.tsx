import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  queryKeys,
  useObsidianCreateProjectTodo,
  useObsidianHealthQuery,
  useObsidianProjectsQuery,
  useObsidianSetProjectRoot,
  useObsidianSync,
  useObsidianReindex,
  useObsidianScan,
  useObsidianFlushQueue,
  useObsidianRetryDeadLetter,
} from '../../hooks/queries';
import { useTranslation, translateUi } from '../../i18n';
import { useToastStore } from '../../stores/useToastStore';
import SettingsRow from './SettingsRow';
/**
 * Obsidian vault status card for the Settings page.
 *
 * Shows: vault connection, CLI availability and mode, companion node status,
 * sync mode, project count, background indexing, write queue, dead letter
 * queue, CLI errors, stuck scan warnings, and bidirectional sync status.
 * Provides actions: export, reindex, scan, flush queue, retry dead letter,
 * set the project root folder, and create a TODO.md for a project without one.
 */
export default function ObsidianStatusCard() {
  const { t, i18n } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const { data: health, isLoading } = useObsidianHealthQuery();
  const syncMutation = useObsidianSync();
  const reindexMutation = useObsidianReindex();
  const scanMutation = useObsidianScan();
  const flushMutation = useObsidianFlushQueue();
  const retryDeadLetterMutation = useObsidianRetryDeadLetter();
  const [showErrors, setShowErrors] = useState(false);
  const queryClient = useQueryClient();
  const vaultAvailable = health?.vault_available ?? false;
  const { data: projectList } = useObsidianProjectsQuery(vaultAvailable);
  const setProjectRootMutation = useObsidianSetProjectRoot();
  const createTodoMutation = useObsidianCreateProjectTodo();
  const savedProjectRoot = health?.project_root ?? projectList?.project_root ?? '';
  const [projectRootDraft, setProjectRootDraft] = useState<string | null>(null);
  const projectRoot = projectRootDraft ?? savedProjectRoot;
  const indexState = health?.index_state;
  useEffect(() => {
    // The list fetched while the startup scan ran may be empty.
    if (indexState === 'ready') {
      void queryClient.invalidateQueries({ queryKey: queryKeys.obsidianProjects });
    }
  }, [indexState, queryClient]);
  if (isLoading) {
    return (
      <div className="cc-settings-section">
        <div className="cc-settings-section__title">{t('workspaceSettings.obsidian.title')}</div>
        <SettingsRow label={t('workspaceSettings.obsidian.status')}>
          <span style={{ fontSize: 12, opacity: 0.6 }}>
            {t('workspaceSettings.obsidian.loading')}
          </span>
        </SettingsRow>
      </div>
    );
  }
  if (!health) return null;
  const statusColor = health.vault_available ? 'var(--cc-success)' : 'var(--cc-danger)';
  const statusText = health.vault_available
    ? t('workspaceSettings.obsidian.connected')
    : t('workspaceSettings.obsidian.unavailable');
  const companionColor = health.companion_online ? 'var(--cc-success)' : 'var(--cc-warning)';
  const companionText = health.companion_online
    ? t('workspaceSettings.obsidian.online')
    : t('workspaceSettings.obsidian.offline');
  const syncLag = health.bidirectional_sync?.sync_lag_seconds;
  const formatLag = (seconds: number | null | undefined) => {
    if (seconds === null || seconds === undefined) return t('workspaceSettings.obsidian.never');
    if (seconds < 60) {
      return t('workspaceSettings.obsidian.secondsAgo', { count: Math.round(seconds) });
    }
    if (seconds < 3600) {
      return t('workspaceSettings.obsidian.minutesAgo', { count: Math.round(seconds / 60) });
    }
    return t('workspaceSettings.obsidian.hoursAgo', { count: Math.round(seconds / 3600) });
  };
  const queueCount = health.write_queue?.pending ?? 0;
  const deadLetterCount = health.dead_letter_count ?? 0;
  const queueAge = health.queue_age_seconds;
  const scanStuck = health.scan_stuck ?? false;
  const lastCliError = health.last_cli_error;
  const projectsWithoutTodo = (projectList?.projects ?? []).filter((project) => !project.has_todo);
  const saveProjectRoot = () => {
    setProjectRootMutation.mutate(projectRoot.trim(), {
      onSuccess: (data) => {
        setProjectRootDraft(null);
        addToast(
          'success',
          t('workspaceSettings.obsidian.projectRootSaved', { count: data.project_count }),
        );
      },
      onError: () => addToast('error', t('workspaceSettings.obsidian.projectRootFailed')),
    });
  };
  return (
    <div className="cc-settings-section">
      <div className="cc-settings-section__title">{t('workspaceSettings.obsidian.title')}</div>

      <SettingsRow
        label={t('workspaceSettings.obsidian.vault')}
        sublabel={health.vault_path || t('workspaceSettings.obsidian.notConfigured')}
      >
        <span style={{ fontSize: 12, color: statusColor, fontWeight: 500 }}>{statusText}</span>
      </SettingsRow>

      <SettingsRow label={t('workspaceSettings.obsidian.syncMode')} sublabel={health.sync_mode}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>
          {t('workspaceSettings.obsidian.projects', { count: health.project_count })}
        </span>
      </SettingsRow>

      {indexState === 'scanning' && (
        <SettingsRow label="">
          <span data-testid="obsidian-indexing" style={{ fontSize: 11, opacity: 0.7 }}>
            {t('workspaceSettings.obsidian.indexing')}
          </span>
        </SettingsRow>
      )}

      <SettingsRow
        label={t('workspaceSettings.obsidian.cli')}
        sublabel={`${
          health.cli_available
            ? t('workspaceSettings.obsidian.available')
            : t('workspaceSettings.obsidian.notAvailable')
        }${health.mode ? ` · ${t('workspaceSettings.obsidian.mode', { mode: health.mode })}` : ''}`}
      >
        <span
          style={{
            fontSize: 12,
            color: health.cli_available ? 'var(--cc-success)' : 'var(--cc-muted)',
          }}
        >
          {health.cli_available ? translateUi('OK') : '--'}
        </span>
      </SettingsRow>

      <SettingsRow label={t('workspaceSettings.obsidian.companionNode')}>
        <span style={{ fontSize: 12, color: companionColor, fontWeight: 500 }}>
          {companionText}
        </span>
      </SettingsRow>

      {health.is_stale && (
        <SettingsRow label="">
          <span style={{ fontSize: 11, color: 'var(--cc-warning)' }}>
            {t('workspaceSettings.obsidian.stale')}
          </span>
        </SettingsRow>
      )}

      {health.error && (
        <SettingsRow label="">
          <span style={{ fontSize: 11, color: 'var(--cc-danger)' }}>{health.error}</span>
        </SettingsRow>
      )}

      {scanStuck && (
        <SettingsRow label="">
          <span style={{ fontSize: 11, color: 'var(--cc-danger)', fontWeight: 500 }}>
            {t('workspaceSettings.obsidian.scanStuck')}
          </span>
        </SettingsRow>
      )}

      {health.vault_available && (
        <SettingsRow
          label={t('workspaceSettings.obsidian.projectRoot')}
          sublabel={t('workspaceSettings.obsidian.projectRootHint')}
        >
          <form
            style={{ display: 'flex', gap: 6 }}
            onSubmit={(event) => {
              event.preventDefault();
              saveProjectRoot();
            }}
          >
            <input
              className="cc-settings-input cc-settings-input--compact"
              aria-label={t('workspaceSettings.obsidian.projectRoot')}
              placeholder={t('workspaceSettings.obsidian.projectRootPlaceholder')}
              value={projectRoot}
              onChange={(event) => setProjectRootDraft(event.target.value)}
            />
            <button
              type="submit"
              className="cc-btn cc-btn--secondary"
              disabled={setProjectRootMutation.isPending || projectRoot.trim() === savedProjectRoot}
              style={{ fontSize: 11, padding: '3px 8px' }}
            >
              {translateUi('Save')}
            </button>
          </form>
        </SettingsRow>
      )}

      {projectsWithoutTodo.length > 0 && (
        <div data-testid="obsidian-missing-todo">
          <SettingsRow label={t('workspaceSettings.obsidian.missingTodo')}>
            <span style={{ fontSize: 12, opacity: 0.7 }}>{projectsWithoutTodo.length}</span>
          </SettingsRow>
          {projectsWithoutTodo.map((project) => {
            const creating =
              createTodoMutation.isPending && createTodoMutation.variables === project.folder;
            return (
              <SettingsRow key={project.folder} label={project.name} sublabel={project.folder}>
                <button
                  type="button"
                  className="cc-btn cc-btn--secondary"
                  disabled={createTodoMutation.isPending}
                  onClick={() => {
                    createTodoMutation.mutate(project.folder, {
                      onSuccess: () =>
                        addToast(
                          'success',
                          t('workspaceSettings.obsidian.todoCreated', { folder: project.folder }),
                        ),
                      onError: () =>
                        addToast('error', t('workspaceSettings.obsidian.todoCreateFailed')),
                    });
                  }}
                  style={{ fontSize: 11, padding: '3px 8px' }}
                >
                  {creating
                    ? t('workspaceSettings.obsidian.creatingTodo')
                    : t('workspaceSettings.obsidian.createTodo')}
                </button>
              </SettingsRow>
            );
          })}
        </div>
      )}

      <SettingsRow label={t('workspaceSettings.obsidian.lastScan')}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>{formatLag(syncLag)}</span>
      </SettingsRow>

      {queueCount > 0 && (
        <SettingsRow
          label={t('workspaceSettings.obsidian.writeQueue')}
          sublabel={`${t('workspaceSettings.obsidian.pending', { count: queueCount })}${
            queueAge
              ? ` · ${t('workspaceSettings.obsidian.oldest', { age: formatLag(queueAge) })}`
              : ''
          }`}
        >
          <button
            type="button"
            className="cc-btn cc-btn--secondary"
            onClick={() => {
              flushMutation.mutate(undefined, {
                onSuccess: (data) =>
                  addToast(
                    'success',
                    t('workspaceSettings.obsidian.flushed', {
                      succeeded: data.succeeded,
                      processed: data.processed,
                    }),
                  ),
                onError: () => addToast('error', t('workspaceSettings.obsidian.flushFailed')),
              });
            }}
            disabled={flushMutation.isPending}
            style={{ fontSize: 12, padding: '4px 10px' }}
          >
            {flushMutation.isPending
              ? t('workspaceSettings.actions.flushing')
              : t('workspaceSettings.actions.flush')}
          </button>
        </SettingsRow>
      )}

      {deadLetterCount > 0 && (
        <SettingsRow
          label={t('workspaceSettings.obsidian.deadLetter')}
          sublabel={t('workspaceSettings.obsidian.failedOperations', {
            count: deadLetterCount,
          })}
        >
          <button
            type="button"
            className="cc-btn cc-btn--secondary"
            onClick={() => {
              retryDeadLetterMutation.mutate(undefined, {
                onSuccess: (data) =>
                  addToast(
                    'success',
                    t('workspaceSettings.obsidian.requeued', { count: data.requeued }),
                  ),
                onError: () => addToast('error', t('workspaceSettings.obsidian.retryFailed')),
              });
            }}
            disabled={retryDeadLetterMutation.isPending}
            style={{ fontSize: 12, padding: '4px 10px' }}
          >
            {retryDeadLetterMutation.isPending
              ? t('workspaceSettings.actions.retrying')
              : t('workspaceSettings.actions.retryAll')}
          </button>
        </SettingsRow>
      )}

      {lastCliError && (
        <SettingsRow label={t('workspaceSettings.obsidian.lastCliError')}>
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
            {lastCliError.error.slice(0, 60)}
            {lastCliError.error.length > 60 ? '...' : ''}
            {showErrors
              ? ` (${t('workspaceSettings.obsidian.hide')})`
              : ` (${t('workspaceSettings.obsidian.show')})`}
          </button>
        </SettingsRow>
      )}

      {showErrors && lastCliError && (
        <SettingsRow label="">
          <div
            style={{
              fontSize: 11,
              opacity: 0.7,
              whiteSpace: 'pre-wrap',
              maxHeight: 120,
              overflow: 'auto',
            }}
          >
            <div>
              {t('workspaceSettings.obsidian.command')}: {lastCliError.command}
            </div>
            <div>
              {t('workspaceSettings.obsidian.error')}: {lastCliError.error}
            </div>
            <div>
              {t('workspaceSettings.obsidian.code')}:{' '}
              {lastCliError.returncode ?? t('workspaceSettings.obsidian.notApplicable')}
            </div>
            <div>
              {t('workspaceSettings.obsidian.time')}:{' '}
              {new Date(lastCliError.timestamp * 1000).toLocaleString(i18n.language)}
            </div>
          </div>
        </SettingsRow>
      )}

      <SettingsRow label={t('workspaceSettings.obsidian.actions')}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className="cc-btn cc-btn--secondary"
            onClick={() => {
              syncMutation.mutate(undefined, {
                onSuccess: (data) =>
                  addToast(
                    'success',
                    t('workspaceSettings.obsidian.exportedTasks', {
                      count: data.exported ?? 0,
                    }),
                  ),
                onError: () => addToast('error', t('workspaceSettings.obsidian.exportFailed')),
              });
            }}
            disabled={syncMutation.isPending || !health.vault_available}
            style={{ fontSize: 11, padding: '3px 8px' }}
          >
            {syncMutation.isPending
              ? t('workspaceSettings.actions.exporting')
              : t('workspaceSettings.actions.export')}
          </button>

          <button
            type="button"
            className="cc-btn cc-btn--secondary"
            onClick={() => {
              reindexMutation.mutate(undefined, {
                onSuccess: (data) =>
                  addToast(
                    'success',
                    t('workspaceSettings.obsidian.indexedProjects', {
                      count: data.project_count,
                    }),
                  ),
                onError: () => addToast('error', t('workspaceSettings.obsidian.reindexFailed')),
              });
            }}
            disabled={reindexMutation.isPending || !health.vault_available}
            style={{ fontSize: 11, padding: '3px 8px' }}
          >
            {reindexMutation.isPending
              ? t('workspaceSettings.actions.indexing')
              : t('workspaceSettings.actions.reindex')}
          </button>

          <button
            type="button"
            className="cc-btn cc-btn--secondary"
            onClick={() => {
              scanMutation.mutate(undefined, {
                onSuccess: (data) =>
                  addToast(
                    'success',
                    t('workspaceSettings.obsidian.scanned', {
                      files: data.files_scanned,
                      changes: data.changes_applied,
                    }),
                  ),
                onError: () => addToast('error', t('workspaceSettings.obsidian.scanFailed')),
              });
            }}
            disabled={scanMutation.isPending || !health.vault_available}
            style={{ fontSize: 11, padding: '3px 8px' }}
          >
            {scanMutation.isPending
              ? t('workspaceSettings.actions.scanning')
              : t('workspaceSettings.actions.scan')}
          </button>
        </div>
      </SettingsRow>

      {!health.companion_online && health.vault_available && (
        <SettingsRow label="">
          <span style={{ fontSize: 11, color: 'var(--cc-warning)', fontStyle: 'italic' }}>
            {t('workspaceSettings.obsidian.companionOffline')}
          </span>
        </SettingsRow>
      )}
    </div>
  );
}
