import { useAdminSessionsQuery, useDisconnectSession } from '../../hooks/queries';
import { useAuthStore } from '../../stores/useAuthStore';
import SettingsSection from '../shared/SettingsSection';
import SettingsRow from '../shared/SettingsRow';
import EmptyState from '../shared/EmptyState';
import { LinkIcon } from '../shared/Icons';
import { translateUi } from '../../i18n';
export default function SessionsTab() {
  const { data, isLoading } = useAdminSessionsQuery();
  const disconnect = useDisconnectSession();
  if (!useAuthStore.getState().serverUrl) {
    return (
      <EmptyState
        icon={<LinkIcon size={20} />}
        message={translateUi('Session management requires a server connection.')}
      />
    );
  }
  if (isLoading || !data)
    return (
      <p style={{ color: 'var(--cc-text-secondary)', fontSize: 13 }}>{translateUi('Loading...')}</p>
    );
  return (
    <SettingsSection
      title={translateUi('Active Connections ({{count}})', { count: data.total_connections })}
    >
      {data.active_connections.length === 0 ? (
        <p style={{ color: 'var(--cc-text-tertiary)', fontSize: 13, padding: '12px 0' }}>
          {translateUi('No active connections')}
        </p>
      ) : (
        data.active_connections.map((s) => (
          <SettingsRow
            key={s.user_id}
            label={s.user_id}
            sublabel={translateUi('WebSocket connected')}
          >
            <button
              className="cc-btn cc-btn--danger"
              onClick={() => disconnect.mutate(s.user_id)}
              disabled={disconnect.isPending}
              style={{ fontSize: 12, padding: '4px 10px' }}
            >
              {translateUi('\n              Disconnect\n            ')}
            </button>
          </SettingsRow>
        ))
      )}
    </SettingsSection>
  );
}
