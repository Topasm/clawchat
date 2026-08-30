import { useState } from 'react';
import AdminTabBar, { type AdminTab } from './AdminTabBar';
import OverviewTab from './OverviewTab';
import AITab from './AITab';
import DatabaseTab from './DatabaseTab';
import ActivityTab from './ActivityTab';
import SessionsTab from './SessionsTab';
import ConfigTab from './ConfigTab';
import DataTab from './DataTab';
import { translateUi } from '../../i18n';
export default function AdminContainer() {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  return (
    <div style={{ maxWidth: 700 }}>
      <div className="cc-page-header">
        <div className="cc-page-header__title">{translateUi('Admin Dashboard')}</div>
        <div className="cc-page-header__subtitle">
          {translateUi('Server management and monitoring')}
        </div>
      </div>

      <AdminTabBar activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === 'overview' && <OverviewTab />}
      {activeTab === 'ai' && <AITab />}
      {activeTab === 'database' && <DatabaseTab />}
      {activeTab === 'activity' && <ActivityTab />}
      {activeTab === 'sessions' && <SessionsTab />}
      {activeTab === 'config' && <ConfigTab />}
      {activeTab === 'data' && <DataTab />}
    </div>
  );
}
