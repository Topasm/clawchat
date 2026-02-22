import { useAdminAIQuery, useTestAIConnection } from '../../hooks/queries';
import SettingsSection from '../shared/SettingsSection';
import SettingsRow from '../shared/SettingsRow';

export default function AITab() {
  const { data, isLoading } = useAdminAIQuery();
  const testConnection = useTestAIConnection();

  if (isLoading || !data) return <p style={{ color: 'var(--cc-text-secondary)', fontSize: 13 }}>Loading...</p>;

  return (
    <>
      <SettingsSection title="AI Provider">
        <SettingsRow label="Provider">
          <span style={{ fontSize: 13 }}>{data.provider}</span>
        </SettingsRow>
        <SettingsRow label="Model">
          <span style={{ fontSize: 13, fontFamily: 'monospace' }}>{data.model}</span>
        </SettingsRow>
        <SettingsRow label="Base URL">
          <span style={{ fontSize: 12, fontFamily: 'monospace' }}>{data.base_url}</span>
        </SettingsRow>
        <SettingsRow label="Status">
          <span className="cc-admin-status">
            <span className={`cc-admin-status__dot cc-admin-status__dot--${data.connected ? 'ok' : 'error'}`} />
            {data.connected ? 'Connected' : 'Disconnected'}
          </span>
        </SettingsRow>
        <SettingsRow label="Test connectivity">
          <button
            className="cc-btn cc-btn--secondary"
            onClick={() => testConnection.mutate()}
            disabled={testConnection.isPending}
            style={{ fontSize: 12, padding: '4px 10px' }}
          >
            {testConnection.isPending ? 'Testing...' : 'Test'}
          </button>
        </SettingsRow>
      </SettingsSection>

      {data.available_models.length > 0 && (
        <SettingsSection title="Available Models">
          <div className="cc-admin-models-list">
            {data.available_models.map((m) => (
              <span key={m} className="cc-admin-model-tag">{m}</span>
            ))}
          </div>
        </SettingsSection>
      )}
    </>
  );
}
