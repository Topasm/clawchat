import { useAdminDataQuery } from '../../hooks/queries';
import { formatDateTimeShort } from '../../utils/formatters';
import SettingsSection from '../shared/SettingsSection';

export default function DataTab() {
  const { data, isLoading } = useAdminDataQuery();

  if (isLoading || !data) return <p style={{ color: 'var(--cc-text-secondary)', fontSize: 13 }}>Loading...</p>;

  return (
    <SettingsSection title="Data Overview by Module">
      <div className="cc-admin-stats">
        {data.modules.map((m) => (
          <div key={m.name} className="cc-admin-stat">
            <div className="cc-admin-stat__label">{m.name}</div>
            <div className="cc-admin-stat__value">{m.count.toLocaleString()}</div>
            {m.oldest && (
              <div style={{ fontSize: 11, color: 'var(--cc-text-tertiary)', marginTop: 4 }}>
                {formatDateTimeShort(m.oldest).split(',')[0]} &mdash; {formatDateTimeShort(m.newest!).split(',')[0]}
              </div>
            )}
          </div>
        ))}
      </div>
    </SettingsSection>
  );
}
