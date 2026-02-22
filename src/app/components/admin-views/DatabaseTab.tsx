import { useState } from 'react';
import {
  useAdminOverviewQuery,
  useReindexFTS,
  useBackupDatabase,
  usePurgeData,
} from '../../hooks/queries';
import { formatBytes } from '../../utils/formatters';
import SettingsSection from '../shared/SettingsSection';
import SettingsRow from '../shared/SettingsRow';
import ConfirmDialog from '../shared/ConfirmDialog';

export default function DatabaseTab() {
  const { data: overview } = useAdminOverviewQuery();
  const reindex = useReindexFTS();
  const backup = useBackupDatabase();
  const purge = usePurgeData();
  const [showReindexConfirm, setShowReindexConfirm] = useState(false);
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false);
  const [purgeTarget, setPurgeTarget] = useState('conversations');
  const [purgeDays, setPurgeDays] = useState(90);

  const storage = overview?.storage;

  return (
    <>
      {storage && (
        <SettingsSection title="Storage">
          <SettingsRow label="Database size">
            <span style={{ fontSize: 13 }}>{formatBytes(storage.db_size_bytes)}</span>
          </SettingsRow>
          <SettingsRow label="Upload directory">
            <span style={{ fontSize: 13 }}>{formatBytes(storage.upload_dir_size_bytes)}</span>
          </SettingsRow>
          <SettingsRow label="Attachments" sublabel={`${storage.attachment_count} files`}>
            <span style={{ fontSize: 13 }}>{formatBytes(storage.attachment_total_bytes)}</span>
          </SettingsRow>
        </SettingsSection>
      )}

      <SettingsSection title="Maintenance">
        <SettingsRow label="Reindex FTS" sublabel="Rebuild full-text search indexes">
          <button
            className="cc-btn cc-btn--secondary"
            onClick={() => setShowReindexConfirm(true)}
            disabled={reindex.isPending}
            style={{ fontSize: 12, padding: '4px 10px' }}
          >
            {reindex.isPending ? 'Reindexing...' : 'Reindex'}
          </button>
        </SettingsRow>
        <SettingsRow label="Backup database" sublabel="Create a timestamped copy of the database">
          <button
            className="cc-btn cc-btn--secondary"
            onClick={() => backup.mutate()}
            disabled={backup.isPending}
            style={{ fontSize: 12, padding: '4px 10px' }}
          >
            {backup.isPending ? 'Creating...' : 'Backup'}
          </button>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Purge Old Data">
        <div className="cc-admin-purge-form">
          <select value={purgeTarget} onChange={(e) => setPurgeTarget(e.target.value)}>
            <option value="conversations">Conversations</option>
            <option value="messages">Messages</option>
            <option value="todos">Completed Todos</option>
          </select>
          <span style={{ fontSize: 13, color: 'var(--cc-text-secondary)' }}>older than</span>
          <input
            type="number"
            min={1}
            value={purgeDays}
            onChange={(e) => setPurgeDays(Number(e.target.value))}
          />
          <span style={{ fontSize: 13, color: 'var(--cc-text-secondary)' }}>days</span>
          <button
            className="cc-btn cc-btn--danger"
            onClick={() => setShowPurgeConfirm(true)}
            disabled={purge.isPending}
            style={{ fontSize: 12, padding: '4px 10px' }}
          >
            {purge.isPending ? 'Purging...' : 'Purge'}
          </button>
        </div>
      </SettingsSection>

      <ConfirmDialog
        open={showReindexConfirm}
        onOpenChange={setShowReindexConfirm}
        title="Reindex FTS"
        description="This will rebuild all full-text search indexes. Existing search data will be temporarily unavailable."
        confirmLabel="Reindex"
        onConfirm={() => reindex.mutate()}
      />

      <ConfirmDialog
        open={showPurgeConfirm}
        onOpenChange={setShowPurgeConfirm}
        title="Purge Data"
        description={`Delete ${purgeTarget} older than ${purgeDays} days. This action cannot be undone.`}
        confirmLabel="Purge"
        danger
        onConfirm={() => purge.mutate({ target: purgeTarget, older_than_days: purgeDays })}
      />
    </>
  );
}
