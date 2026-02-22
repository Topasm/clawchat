import { useAdminActivityQuery } from '../../hooks/queries';
import { relativeTime } from '../../utils/formatters';
import SettingsSection from '../shared/SettingsSection';

export default function ActivityTab() {
  const { data, isLoading } = useAdminActivityQuery();

  if (isLoading || !data) return <p style={{ color: 'var(--cc-text-secondary)', fontSize: 13 }}>Loading...</p>;

  return (
    <>
      <SettingsSection title="Recent Activity">
        {data.recent.length === 0 ? (
          <p style={{ color: 'var(--cc-text-tertiary)', fontSize: 13, padding: '12px 0' }}>No activity yet</p>
        ) : (
          <div className="cc-admin-activity-list">
            {data.recent.map((item) => (
              <div key={`${item.type}-${item.id}`} className="cc-admin-activity-item">
                <span className="cc-admin-activity-item__badge">{item.type}</span>
                <div className="cc-admin-activity-item__body">
                  <div className="cc-admin-activity-item__summary">{item.summary}</div>
                  <div className="cc-admin-activity-item__time">{relativeTime(item.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>

      <SettingsSection title="Agent Task History">
        {data.agent_tasks.length === 0 ? (
          <p style={{ color: 'var(--cc-text-tertiary)', fontSize: 13, padding: '12px 0' }}>No agent tasks yet</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="cc-admin-tasks-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Agent</th>
                  <th>Status</th>
                  <th>Instruction</th>
                  <th>Completed</th>
                </tr>
              </thead>
              <tbody>
                {data.agent_tasks.map((t) => (
                  <tr key={t.id}>
                    <td>{t.task_type}</td>
                    <td>{t.agent_type}</td>
                    <td>
                      <span className="cc-admin-status">
                        <span className={`cc-admin-status__dot cc-admin-status__dot--${t.status === 'completed' ? 'ok' : 'error'}`} />
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
