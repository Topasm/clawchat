import { useAdminDataQuery } from '../../hooks/queries';
import { formatDateTimeShort } from '../../utils/formatters';
import { useAuthStore } from '../../stores/useAuthStore';
import SettingsSection from '../shared/SettingsSection';
import EmptyState from '../shared/EmptyState';
import { FolderIcon } from '../shared/Icons';
import { translateUi } from '../../i18n';
export default function DataTab() {
  const { data, isLoading } = useAdminDataQuery();
  if (!useAuthStore.getState().serverUrl) {
    return (
      <EmptyState
        icon={<FolderIcon size={20} />}
        message={translateUi('Data overview requires a server connection.')}
      />
    );
  }
  if (isLoading || !data)
    return (
      <p style={{ color: 'var(--cc-text-secondary)', fontSize: 13 }}>{translateUi('Loading...')}</p>
    );
  return (
    <SettingsSection title={translateUi('Data Overview by Module')}>
      <div className="cc-admin-stats">
        {data.modules.map((m) => (
          <div key={m.name} className="cc-admin-stat">
            <div className="cc-admin-stat__label">{m.name}</div>
            <div className="cc-admin-stat__value">{m.count.toLocaleString()}</div>
            {m.oldest && (
              <div style={{ fontSize: 11, color: 'var(--cc-text-tertiary)', marginTop: 4 }}>
                {formatDateTimeShort(m.oldest).split(',')[0]} &mdash;{' '}
                {formatDateTimeShort(m.newest!).split(',')[0]}
              </div>
            )}
          </div>
        ))}
      </div>
    </SettingsSection>
  );
}
