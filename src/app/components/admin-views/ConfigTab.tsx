import { useAdminConfigQuery } from '../../hooks/queries';
import { useAuthStore } from '../../stores/useAuthStore';
import SettingsSection from '../shared/SettingsSection';
import EmptyState from '../shared/EmptyState';

export default function ConfigTab() {
  const { data, isLoading } = useAdminConfigQuery();

  if (!useAuthStore.getState().serverUrl) {
    return <EmptyState icon="⚙️" message="Server configuration requires a server connection." />;
  }

  if (isLoading || !data) return <p style={{ color: 'var(--cc-text-secondary)', fontSize: 13 }}>Loading...</p>;

  const entries: [string, string][] = [
    ['Host', data.host],
    ['Port', String(data.port)],
    ['Database', data.database_url],
    ['JWT Expiry', `${data.jwt_expiry_hours}h`],
    ['AI Provider', data.ai_backend],
    ['AI Base URL', data.ai_base_url],
    ['AI Model', data.ai_model],
    ['Upload Dir', data.upload_dir],
    ['Max Upload Size', `${data.max_upload_size_mb} MB`],
    ['Allowed Extensions', data.allowed_extensions],
    ['Scheduler', data.enable_scheduler ? 'Enabled' : 'Disabled'],
    ['Briefing Time', data.briefing_time],
    ['Reminder Interval', `${data.reminder_check_interval} min`],
    ['Debug', data.debug ? 'On' : 'Off'],
  ];

  return (
    <SettingsSection title="Server Configuration (read-only)">
      {entries.map(([key, value]) => (
        <div key={key} className="cc-admin-config-row">
          <span className="cc-admin-config-row__key">{key}</span>
          <span className="cc-admin-config-row__value">{value}</span>
        </div>
      ))}
    </SettingsSection>
  );
}
