import SettingsShell from '../components/settings/SettingsShell';
import AdminContainer from '../components/admin-views/AdminContainer';
import { translateUi, useTranslation } from '../i18n';

/** The server dashboard, as the last settings pane rather than a nav item of its own. */
export default function ServerSettingsPage() {
  const { t } = useTranslation();
  return (
    <SettingsShell
      activePane="server"
      title={translateUi('Server')}
      description={t('settingsShell.serverDescription')}
    >
      <AdminContainer embedded />
    </SettingsShell>
  );
}
