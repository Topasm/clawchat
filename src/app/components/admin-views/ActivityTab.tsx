import { useAdminActivityQuery } from '../../hooks/queries';
import { relativeTime } from '../../utils/formatters';
import { useAuthStore } from '../../stores/useAuthStore';
import SettingsSection from '../shared/SettingsSection';
import EmptyState from '../shared/EmptyState';
import { ChartIcon } from '../shared/Icons';
import { translateUi } from '../../i18n';
export default function ActivityTab() {
  const { data, isLoading } = useAdminActivityQuery();
  if (!useAuthStore.getState().serverUrl) {
    return (
      <EmptyState
        icon={<ChartIcon size={20} />}
        message={translateUi('Activity log requires a server connection.')}
      />
    );
  }
  if (isLoading || !data)
    return (
      <p style={{ color: 'var(--cc-text-secondary)', fontSize: 13 }}>{translateUi('Loading...')}</p>
    );
  return (
    <>
      <SettingsSection title={translateUi('Recent Activity')}>
        {data.recent.length === 0 ? (
          <p style={{ color: 'var(--cc-text-tertiary)', fontSize: 13, padding: '12px 0' }}>
            {translateUi('No activity yet')}
          </p>
        ) : (
          <div className="cc-admin-activity-list">
            {data.recent.map((item) => (
              <div key={`${item.type}-${item.id}`} className="cc-admin-activity-item">
                <span className="cc-admin-activity-item__badge">{item.type}</span>
                <div className="cc-admin-activity-item__body">
                  <div className="cc-admin-activity-item__summary">{item.summary}</div>
                  <div className="cc-admin-activity-item__time">
                    {relativeTime(item.created_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>

      <SettingsSection title={translateUi('Agent Task History')}>
        {data.agent_tasks.length === 0 ? (
          <p style={{ color: 'var(--cc-text-tertiary)', fontSize: 13, padding: '12px 0' }}>
            {translateUi('No agent tasks yet')}
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="cc-admin-tasks-table">
              <thead>
                <tr>
                  <th>{translateUi('Type')}</th>
                  <th>{translateUi('Agent')}</th>
                  <th>{translateUi('Status')}</th>
                  <th>{translateUi('Instruction')}</th>
                  <th>{translateUi('Completed')}</th>
                </tr>
              </thead>
              <tbody>
                {data.agent_tasks.map((t) => (
                  <tr key={t.id}>
                    <td>{t.task_type}</td>
                    <td>{t.skill_chain?.join(' → ') || t.agent_type}</td>
                    <td>
                      <span className="cc-admin-status">
                        <span
                          className={`cc-admin-status__dot cc-admin-status__dot--${t.status === 'completed' ? 'ok' : 'error'}`}
                        />
                        {t.status}
                      </span>
                    </td>
                    <td title={t.instruction}>{t.instruction}</td>
                    <td>{t.completed_at ? relativeTime(t.completed_at) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SettingsSection>
    </>
  );
}
