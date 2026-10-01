import { useState } from 'react';
import AdminTabBar, { type AdminTab } from './AdminTabBar';
import OverviewTab from './OverviewTab';
import DatabaseTab from './DatabaseTab';
import ActivityTab from './ActivityTab';
import SessionsTab from './SessionsTab';
import ConfigTab from './ConfigTab';
import DataTab from './DataTab';
import { translateUi } from '../../i18n';
/** `embedded`: inside the settings shell, whose pane header already names the page. */
export default function AdminContainer({ embedded = false }: { embedded?: boolean }) {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  return (
    <div style={{ maxWidth: 700 }}>
      {!embedded && (
        <div className="cc-page-header">
          <div className="cc-page-header__title">{translateUi('Admin Dashboard')}</div>
          <div className="cc-page-header__subtitle">
            {translateUi('Server management and monitoring')}
          </div>
        </div>
      )}

      <AdminTabBar activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === 'overview' && <OverviewTab />}
      {activeTab === 'database' && <DatabaseTab />}
      {activeTab === 'activity' && <ActivityTab />}
      {activeTab === 'sessions' && <SessionsTab />}
      {activeTab === 'config' && <ConfigTab />}
      {activeTab === 'data' && <DataTab />}
    </div>
  );
}
