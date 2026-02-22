export type AdminTab = 'overview' | 'ai' | 'database' | 'activity' | 'sessions' | 'config' | 'data';

const TABS: { key: AdminTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'ai', label: 'AI Config' },
  { key: 'database', label: 'Database' },
  { key: 'activity', label: 'Activity' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'config', label: 'Server Config' },
  { key: 'data', label: 'Data Mgmt' },
];

interface AdminTabBarProps {
  activeTab: AdminTab;
  onTabChange: (tab: AdminTab) => void;
}

export default function AdminTabBar({ activeTab, onTabChange }: AdminTabBarProps) {
  return (
    <div className="cc-admin-tabs">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          className={`cc-admin-tab${activeTab === tab.key ? ' cc-admin-tab--active' : ''}`}
          onClick={() => onTabChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
