import { useAdminOverviewQuery } from '../../hooks/queries';
import { formatBytes, formatUptime } from '../../utils/formatters';
import { useAuthStore } from '../../stores/useAuthStore';
import SettingsSection from '../shared/SettingsSection';
import SettingsRow from '../shared/SettingsRow';
import EmptyState from '../shared/EmptyState';
import { PlugIcon } from '../shared/Icons';
import { translateUi } from '../../i18n';
export default function OverviewTab() {
  const { data, isLoading } = useAdminOverviewQuery();
  if (!useAuthStore.getState().serverUrl) {
    return (
      <EmptyState
        icon={<PlugIcon size={20} />}
        message={translateUi(
          'Admin dashboard requires a server connection. Connect to a server in Settings to view server statistics.',
        )}
      />
    );
  }
  if (isLoading || !data)
    return (
      <p style={{ color: 'var(--cc-text-secondary)', fontSize: 13 }}>{translateUi('Loading...')}</p>
    );
  const { server, counts, storage } = data;
  return (
    <>
      <SettingsSection title={translateUi('Server Info')}>
        <SettingsRow label={translateUi('Uptime')}>
          <span style={{ fontSize: 13 }}>{formatUptime(server.uptime_seconds)}</span>
        </SettingsRow>
        <SettingsRow label={translateUi('Version')}>
          <span style={{ fontSize: 13 }}>{server.version}</span>
        </SettingsRow>
        <SettingsRow label={translateUi('AI Status')}>
          <span className="cc-admin-status">
            <span
              className={`cc-admin-status__dot cc-admin-status__dot--${server.ai_connected ? 'ok' : 'error'}`}
            />
            {server.ai_connected ? translateUi('Connected') : translateUi('Disconnected')}
          </span>
        </SettingsRow>
        <SettingsRow label={translateUi('AI Provider')}>
          <span style={{ fontSize: 13 }}>
            {server.ai_backend} / {server.ai_model}
          </span>
        </SettingsRow>
        <SettingsRow label={translateUi('WebSocket Connections')}>
          <span style={{ fontSize: 13 }}>{server.active_ws_connections}</span>
        </SettingsRow>
        <SettingsRow label={translateUi('Scheduler')}>
          <span style={{ fontSize: 13 }}>
            {server.scheduler_enabled
              ? server.scheduler_running
                ? translateUi('Running')
                : translateUi('Enabled (stopped)')
              : translateUi('Disabled')}
          </span>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={translateUi('Data Counts')}>
        <div className="cc-admin-stats">
          {Object.entries(counts).map(([key, value]) => (
            <div key={key} className="cc-admin-stat">
              <div className="cc-admin-stat__label">{key.replace(/_/g, ' ')}</div>
              <div className="cc-admin-stat__value">{value.toLocaleString()}</div>
            </div>
          ))}
        </div>
      </SettingsSection>

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
    </>
  );
}
