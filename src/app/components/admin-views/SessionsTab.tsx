import { useAdminSessionsQuery, useDisconnectSession } from '../../hooks/queries';
import SettingsSection from '../shared/SettingsSection';
import SettingsRow from '../shared/SettingsRow';

export default function SessionsTab() {
  const { data, isLoading } = useAdminSessionsQuery();
  const disconnect = useDisconnectSession();

  if (isLoading || !data) return <p style={{ color: 'var(--cc-text-secondary)', fontSize: 13 }}>Loading...</p>;

  return (
    <SettingsSection title={`Active Connections (${data.total_connections})`}>
      {data.active_connections.length === 0 ? (
        <p style={{ color: 'var(--cc-text-tertiary)', fontSize: 13, padding: '12px 0' }}>No active connections</p>
      ) : (
        data.active_connections.map((s) => (
          <SettingsRow key={s.user_id} label={s.user_id} sublabel="WebSocket connected">
            <button
              className="cc-btn cc-btn--danger"
              onClick={() => disconnect.mutate(s.user_id)}
              disabled={disconnect.isPending}
              style={{ fontSize: 12, padding: '4px 10px' }}
            >
              Disconnect
            </button>
          </SettingsRow>
        ))
      )}
    </SettingsSection>
  );
}
