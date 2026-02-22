import { useAdminOverviewQuery } from '../../hooks/queries';
import { formatBytes, formatUptime } from '../../utils/formatters';
import SettingsSection from '../shared/SettingsSection';
import SettingsRow from '../shared/SettingsRow';

export default function OverviewTab() {
  const { data, isLoading } = useAdminOverviewQuery();

  if (isLoading || !data) return <p style={{ color: 'var(--cc-text-secondary)', fontSize: 13 }}>Loading...</p>;

  const { server, counts, storage } = data;

  return (
    <>
      <SettingsSection title="Server Info">
        <SettingsRow label="Uptime">
          <span style={{ fontSize: 13 }}>{formatUptime(server.uptime_seconds)}</span>
        </SettingsRow>
        <SettingsRow label="Version">
          <span style={{ fontSize: 13 }}>{server.version}</span>
        </SettingsRow>
        <SettingsRow label="AI Status">
          <span className="cc-admin-status">
            <span className={`cc-admin-status__dot cc-admin-status__dot--${server.ai_connected ? 'ok' : 'error'}`} />
            {server.ai_connected ? 'Connected' : 'Disconnected'}
          </span>
        </SettingsRow>
        <SettingsRow label="AI Provider">
          <span style={{ fontSize: 13 }}>{server.ai_provider} / {server.ai_model}</span>
        </SettingsRow>
        <SettingsRow label="WebSocket Connections">
          <span style={{ fontSize: 13 }}>{server.active_ws_connections}</span>
        </SettingsRow>
        <SettingsRow label="Scheduler">
          <span style={{ fontSize: 13 }}>
            {server.scheduler_enabled ? (server.scheduler_running ? 'Running' : 'Enabled (stopped)') : 'Disabled'}
          </span>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Data Counts">
        <div className="cc-admin-stats">
          {Object.entries(counts).map(([key, value]) => (
            <div key={key} className="cc-admin-stat">
              <div className="cc-admin-stat__label">{key.replace(/_/g, ' ')}</div>
              <div className="cc-admin-stat__value">{value.toLocaleString()}</div>
            </div>
          ))}
        </div>
      </SettingsSection>

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
    </>
  );
}
