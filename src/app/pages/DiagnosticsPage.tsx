import { useEffect, useState } from 'react';
import SettingsShell from '../components/settings/SettingsShell';
import SettingsSection from '../components/shared/SettingsSection';
import DebugLoggingSection from '../components/settings/DebugLoggingSection';
import { PropertyRow } from '../components/shared/WorkspacePrimitives';
import { platformApi } from '../platform';
import { useToastStore } from '../stores/useToastStore';
import { useWorkspaceRuntimeStore } from '../stores/useWorkspaceRuntimeStore';
import {
  resetWorkspaceConnections,
  retryLocalWorkspace,
} from '../services/workspaceSessionCoordinator';
import { translateUi, useTranslation } from '../i18n';
function displayStatus(state: string | undefined) {
  if (!state) return translateUi('Unknown');
  return translateUi(state.charAt(0).toUpperCase() + state.slice(1));
}
export default function DiagnosticsPage() {
  const { t } = useTranslation();
  const addToast = useToastStore((state) => state.addToast);
  const config = useWorkspaceRuntimeStore((state) => state.config);
  const status = useWorkspaceRuntimeStore((state) => state.localServerStatus);
  const runtimeError = useWorkspaceRuntimeStore((state) => state.error);
  const initialize = useWorkspaceRuntimeStore((state) => state.initialize);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    void initialize();
  }, [initialize]);
  const retry = async () => {
    setBusy(true);
    setError('');
    try {
      await retryLocalWorkspace();
      addToast('success', translateUi('The local workspace is ready.'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const openFolder = async (kind: 'log' | 'data') => {
    setError('');
    try {
      if (kind === 'log') await platformApi.server.openLogFolder();
      else await platformApi.server.openDataFolder();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const resetConnections = async () => {
    await resetWorkspaceConnections();
    addToast(
      'success',
      translateUi('Saved remote connections were reset. Local workspace data was kept.'),
    );
  };
  return (
    <SettingsShell
      activePane="diagnostics"
      title={translateUi('Diagnostics & Recovery')}
      description={t('settingsShell.diagnosticsDescription')}
    >
      <div className="cc-settings-page">
        <DebugLoggingSection />
        <SettingsSection title={translateUi('Local server status')}>
          <dl className="cc-diagnostics-grid">
            <div>
              <dt>{translateUi('Status')}</dt>
              <dd>{displayStatus(status?.state)}</dd>
            </div>
            <div>
              <dt>{translateUi('Port')}</dt>
              <dd>{status?.port || config?.port || translateUi('Automatic')}</dd>
            </div>
            <div>
              <dt>{translateUi('Process')}</dt>
              <dd>{status?.pid ?? translateUi('Not running')}</dd>
            </div>
            <div>
              <dt>{translateUi('Local server policy')}</dt>
              <dd>
                {config?.localServerEnabled ? translateUi('Enabled') : translateUi('Disabled')}
              </dd>
            </div>
          </dl>
          {(error || runtimeError || status?.error) && (
            <div className="cc-diagnostics-error" role="alert">
              {error || runtimeError || status?.error}
            </div>
          )}
          <div className="cc-diagnostics-actions">
            <button
              type="button"
              className="cc-btn cc-btn--primary"
              disabled={busy}
              onClick={() => void retry()}
            >
              {busy ? translateUi('Trying\u2026') : translateUi('Try local server again')}
            </button>
            <button
              type="button"
              className="cc-btn cc-btn--secondary"
              onClick={() => void openFolder('log')}
            >
              {translateUi('\n              Open log folder\n            ')}
            </button>
            <button
              type="button"
              className="cc-btn cc-btn--secondary"
              onClick={() => void openFolder('data')}
            >
              {translateUi('\n              Open data folder\n            ')}
            </button>
          </div>
        </SettingsSection>

        <SettingsSection title={translateUi('Connection recovery')}>
          <PropertyRow className="cc-workspace-preference">
            <div>
              <div className="cc-workspace-card__name">
                {translateUi('Reset saved connections')}
              </div>
              <div className="cc-workspace-card__description">
                {translateUi(
                  '\n                Sign out and remove remote workspace profiles. Tasks stored on this device are not\n                deleted.\n              ',
                )}
              </div>
            </div>
            <button
              type="button"
              className="cc-btn cc-btn--danger cc-btn--compact"
              onClick={() => void resetConnections()}
            >
              {translateUi('\n              Reset connections\n            ')}
            </button>
          </PropertyRow>
        </SettingsSection>
      </div>
    </SettingsShell>
  );
}
