import { useAdminAIQuery, useTestAIConnection } from '../../hooks/queries';
import { useAuthStore } from '../../stores/useAuthStore';
import SettingsSection from '../shared/SettingsSection';
import SettingsRow from '../shared/SettingsRow';
import EmptyState from '../shared/EmptyState';
import { RobotIcon } from '../shared/Icons';
import { translateUi } from '../../i18n';
export default function AITab() {
  const { data, isLoading } = useAdminAIQuery();
  const testConnection = useTestAIConnection();
  if (!useAuthStore.getState().serverUrl) {
    return (
      <EmptyState
        icon={<RobotIcon size={20} />}
        message={translateUi('AI configuration requires a server connection.')}
      />
    );
  }
  if (isLoading || !data)
    return (
      <p style={{ color: 'var(--cc-text-secondary)', fontSize: 13 }}>{translateUi('Loading...')}</p>
    );
  return (
    <>
      <SettingsSection title={translateUi('AI Provider')}>
        <SettingsRow label={translateUi('Provider')}>
          <span style={{ fontSize: 13 }}>{data.backend}</span>
        </SettingsRow>
        <SettingsRow label={translateUi('Model')}>
          <span style={{ fontSize: 13, fontFamily: 'monospace' }}>{data.model}</span>
        </SettingsRow>
        <SettingsRow label={translateUi('Base URL')}>
          <span style={{ fontSize: 12, fontFamily: 'monospace' }}>{data.base_url}</span>
        </SettingsRow>
        <SettingsRow label={translateUi('Status')}>
          <span className="cc-admin-status">
            <span
              className={`cc-admin-status__dot cc-admin-status__dot--${data.connected ? 'ok' : 'error'}`}
            />
            {data.connected ? translateUi('Connected') : translateUi('Disconnected')}
          </span>
        </SettingsRow>
        <SettingsRow label={translateUi('Test connectivity')}>
          <button
            className="cc-btn cc-btn--secondary"
            onClick={() => testConnection.mutate()}
            disabled={testConnection.isPending}
            style={{ fontSize: 12, padding: '4px 10px' }}
          >
            {testConnection.isPending ? translateUi('Testing...') : translateUi('Test')}
          </button>
        </SettingsRow>
      </SettingsSection>

      {data.available_models.length > 0 && (
        <SettingsSection title={translateUi('Available Models')}>
          <div className="cc-admin-models-list">
            {data.available_models.map((m) => (
              <span key={m} className="cc-admin-model-tag">
                {m}
              </span>
            ))}
          </div>
        </SettingsSection>
      )}
    </>
  );
}
