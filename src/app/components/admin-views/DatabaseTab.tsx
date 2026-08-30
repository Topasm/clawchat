import { useState } from 'react';
import {
  useAdminOverviewQuery,
  useReindexFTS,
  useBackupDatabase,
  usePurgeData,
} from '../../hooks/queries';
import { formatBytes } from '../../utils/formatters';
import { useAuthStore } from '../../stores/useAuthStore';
import SettingsSection from '../shared/SettingsSection';
import SettingsRow from '../shared/SettingsRow';
import ConfirmDialog from '../shared/ConfirmDialog';
import EmptyState from '../shared/EmptyState';
import { DatabaseIcon } from '../shared/Icons';
import { translateUi } from '../../i18n';
export default function DatabaseTab() {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const { data: overview } = useAdminOverviewQuery();
  const reindex = useReindexFTS();
  const backup = useBackupDatabase();
  const purge = usePurgeData();
  const [showReindexConfirm, setShowReindexConfirm] = useState(false);
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false);
  const [purgeTarget, setPurgeTarget] = useState('conversations');
  const [purgeDays, setPurgeDays] = useState(90);
  if (!serverUrl) {
    return (
      <EmptyState
        icon={<DatabaseIcon size={20} />}
        message={translateUi('Database management requires a server connection.')}
      />
    );
  }
  const storage = overview?.storage;
  return (
    <>
      {storage && (
        <SettingsSection title={translateUi('Storage')}>
          <SettingsRow label={translateUi('Database size')}>
            <span style={{ fontSize: 13 }}>{formatBytes(storage.db_size_bytes)}</span>
          </SettingsRow>
          <SettingsRow label={translateUi('Upload directory')}>
            <span style={{ fontSize: 13 }}>{formatBytes(storage.upload_dir_size_bytes)}</span>
          </SettingsRow>
          <SettingsRow
            label={translateUi('Attachments')}
            sublabel={translateUi('{{count}} files', { count: storage.attachment_count })}
          >
            <span style={{ fontSize: 13 }}>{formatBytes(storage.attachment_total_bytes)}</span>
          </SettingsRow>
        </SettingsSection>
      )}

      <SettingsSection title={translateUi('Maintenance')}>
        <SettingsRow
          label={translateUi('Reindex FTS')}
          sublabel={translateUi('Rebuild full-text search indexes')}
        >
          <button
            className="cc-btn cc-btn--secondary"
            onClick={() => setShowReindexConfirm(true)}
            disabled={reindex.isPending}
            style={{ fontSize: 12, padding: '4px 10px' }}
          >
            {reindex.isPending ? translateUi('Reindexing...') : translateUi('Reindex')}
          </button>
        </SettingsRow>
        <SettingsRow
          label={translateUi('Backup database')}
          sublabel={translateUi('Create a timestamped copy of the database')}
        >
          <button
            className="cc-btn cc-btn--secondary"
            onClick={() => backup.mutate()}
            disabled={backup.isPending}
            style={{ fontSize: 12, padding: '4px 10px' }}
          >
            {backup.isPending ? translateUi('Creating...') : translateUi('Backup')}
          </button>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={translateUi('Purge Old Data')}>
        <div className="cc-admin-purge-form">
          <select value={purgeTarget} onChange={(e) => setPurgeTarget(e.target.value)}>
            <option value="conversations">{translateUi('Conversations')}</option>
            <option value="messages">{translateUi('Messages')}</option>
            <option value="todos">{translateUi('Completed Todos')}</option>
          </select>
          <span style={{ fontSize: 13, color: 'var(--cc-text-secondary)' }}>
            {translateUi('older than')}
          </span>
          <input
            type="number"
            min={1}
            value={purgeDays}
            onChange={(e) => setPurgeDays(Number(e.target.value))}
          />
          <span style={{ fontSize: 13, color: 'var(--cc-text-secondary)' }}>
            {translateUi('days')}
          </span>
          <button
            className="cc-btn cc-btn--danger"
            onClick={() => setShowPurgeConfirm(true)}
            disabled={purge.isPending}
            style={{ fontSize: 12, padding: '4px 10px' }}
          >
            {purge.isPending ? translateUi('Purging...') : translateUi('Purge')}
          </button>
        </div>
      </SettingsSection>

      <ConfirmDialog
        open={showReindexConfirm}
        onOpenChange={setShowReindexConfirm}
        title={translateUi('Reindex FTS')}
        description={translateUi(
          'This will rebuild all full-text search indexes. Existing search data will be temporarily unavailable.',
        )}
        confirmLabel={translateUi('Reindex')}
        onConfirm={() => reindex.mutate()}
      />

      <ConfirmDialog
        open={showPurgeConfirm}
        onOpenChange={setShowPurgeConfirm}
        title={translateUi('Purge Data')}
        description={translateUi(
          'Delete {{target}} older than {{days}} days. This action cannot be undone.',
          { target: purgeTarget, days: purgeDays },
        )}
        confirmLabel={translateUi('Purge')}
        danger
        onConfirm={() => purge.mutate({ target: purgeTarget, older_than_days: purgeDays })}
      />
    </>
  );
}
