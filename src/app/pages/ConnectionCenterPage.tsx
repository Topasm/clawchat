import WorkspaceConnectionsSection from '../components/settings/WorkspaceConnectionsSection';
import SettingsShell from '../components/settings/SettingsShell';
import { useTranslation } from '../i18n';
export default function ConnectionCenterPage() {
  const { t } = useTranslation();
  return (
    <SettingsShell
      activePane="connections"
      title={t('settingsShell.connections')}
      description={t('settingsShell.connectionsDescription')}
    >
      <div className="cc-settings-page">
        <WorkspaceConnectionsSection />
      </div>
    </SettingsShell>
  );
}
