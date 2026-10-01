import { useNavigate } from 'react-router-dom';
import WorkspaceConnectionsSection from '../components/settings/WorkspaceConnectionsSection';
import SettingsShell from '../components/settings/SettingsShell';
import SettingsSection from '../components/shared/SettingsSection';
import SettingsRow from '../components/shared/SettingsRow';
import PairingCodeDisplay from '../components/pairing/PairingCodeDisplay';
import { PropertyRow } from '../components/shared/WorkspacePrimitives';
import usePlatform from '../hooks/usePlatform';
import { useAuthStore } from '../stores/useAuthStore';
import { useToastStore } from '../stores/useToastStore';
import { LOCAL_WORKSPACE_ID, useWorkspaceStore } from '../stores/useWorkspaceStore';
import { resetWorkspaceConnections } from '../services/workspaceSessionCoordinator';
import { translateUi, useTranslation } from '../i18n';

/**
 * Everything about who this app talks to: workspaces, the local server, the
 * remote session, mobile pairing, and the reset that forgets it all. These
 * used to be split between here, Workspace & AI, and Diagnostics.
 */
export default function ConnectionCenterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isDesktop } = usePlatform();
  const token = useAuthStore((state) => state.token);
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const logout = useAuthStore((state) => state.logout);
  const addToast = useToastStore((state) => state.addToast);
  const isHost = useWorkspaceStore((state) => state.activeWorkspaceId === LOCAL_WORKSPACE_ID);
  const resetConnections = async () => {
    await resetWorkspaceConnections();
    addToast(
      'success',
      translateUi('Saved remote connections were reset. Local workspace data was kept.'),
    );
  };
  return (
    <SettingsShell
      activePane="connections"
      title={t('settingsShell.connections')}
      description={t('settingsShell.connectionsDescription')}
    >
      <div className="cc-settings-page">
        <WorkspaceConnectionsSection />

        {!isDesktop && token && (
          <SettingsSection title={t('workspaceSettings.sections.serverConnection')}>
            <SettingsRow
              label={t('workspaceSettings.serverConnection.server')}
              sublabel={serverUrl ?? t('workspaceSettings.serverConnection.unknown')}
            >
              <span className="cc-settings-status cc-settings-status--success">
                {t('connection.connected')}
              </span>
            </SettingsRow>
            <SettingsRow
              label={t('workspaceSettings.serverConnection.logout')}
              sublabel={t('workspaceSettings.serverConnection.logoutHint')}
            >
              <button
                type="button"
                className="cc-btn cc-btn--danger cc-btn--compact"
                onClick={() => {
                  void logout();
                  navigate('/login');
                }}
              >
                {t('workspaceSettings.actions.logout')}
              </button>
            </SettingsRow>
          </SettingsSection>
        )}

        {isDesktop && isHost && token && (
          <SettingsSection title={t('workspaceSettings.sections.connectMobile')}>
            <PairingCodeDisplay />
          </SettingsSection>
        )}

        <SettingsSection title={translateUi('Connection recovery')}>
          <PropertyRow className="cc-workspace-preference">
            <div>
              <div className="cc-workspace-card__name">
                {translateUi('Reset saved connections')}
              </div>
              <div className="cc-workspace-card__description">
                {translateUi(
                  'Sign out and remove remote workspace profiles. Tasks stored on this device are not deleted.',
                )}
              </div>
            </div>
            <button
              type="button"
              className="cc-btn cc-btn--danger cc-btn--compact"
              onClick={() => void resetConnections()}
            >
              {translateUi('Reset connections')}
            </button>
          </PropertyRow>
        </SettingsSection>
      </div>
    </SettingsShell>
  );
}
