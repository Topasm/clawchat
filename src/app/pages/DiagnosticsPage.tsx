import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SettingsSection from '../components/shared/SettingsSection';
import ToastContainer from '../components/shared/ToastContainer';
import { platformApi } from '../platform';
import { useAuthStore } from '../stores/useAuthStore';
import { useHostSessionStore } from '../stores/useHostSessionStore';
import { useToastStore } from '../stores/useToastStore';
import { useWorkspaceRuntimeStore } from '../stores/useWorkspaceRuntimeStore';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';

function displayStatus(state: string | undefined) {
  if (!state) return 'Unknown';
  return state.charAt(0).toUpperCase() + state.slice(1);
}

export default function DiagnosticsPage() {
  const navigate = useNavigate();
  const addToast = useToastStore((state) => state.addToast);
  const config = useWorkspaceRuntimeStore((state) => state.config);
  const status = useWorkspaceRuntimeStore((state) => state.localServerStatus);
  const runtimeError = useWorkspaceRuntimeStore((state) => state.error);
  const initialize = useWorkspaceRuntimeStore((state) => state.initialize);
  const refresh = useWorkspaceRuntimeStore((state) => state.refresh);
  const updatePolicy = useWorkspaceRuntimeStore((state) => state.updateLocalServerPolicy);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void initialize();
  }, [initialize]);

  const retry = async () => {
    setBusy(true);
    setError('');
    try {
      await updatePolicy({ localServerEnabled: true });
      useHostSessionStore.getState().reset();
      await useHostSessionStore.getState().retryHostStartup();
      await refresh();
      addToast('success', 'The local workspace is ready.');
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

  const resetConnections = () => {
    useHostSessionStore.getState().deactivate();
    useAuthStore.getState().logout();
    useWorkspaceStore.getState().reset();
    addToast('success', 'Saved remote connections were reset. Local workspace data was kept.');
  };

  return (
    <div className="cc-public-shell">
      <header className="cc-public-shell__header">
        <div>
          <div className="cc-public-shell__eyebrow">ClawChat</div>
          <h1>Diagnostics & Recovery</h1>
          <p>This page remains available even when no workspace server can be reached.</p>
        </div>
        <button
          type="button"
          className="cc-btn cc-btn--secondary"
          onClick={() => navigate('/connections')}
        >
          Connections
        </button>
      </header>

      <main className="cc-public-shell__content cc-settings-page">
        <SettingsSection title="Local server status">
          <dl className="cc-diagnostics-grid">
            <div>
              <dt>Status</dt>
              <dd>{displayStatus(status?.state)}</dd>
            </div>
            <div>
              <dt>Port</dt>
              <dd>{status?.port || config?.port || 'Automatic'}</dd>
            </div>
            <div>
              <dt>Process</dt>
              <dd>{status?.pid ?? 'Not running'}</dd>
            </div>
            <div>
              <dt>Local server policy</dt>
              <dd>{config?.localServerEnabled ? 'Enabled' : 'Disabled'}</dd>
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
              {busy ? 'Trying…' : 'Try local server again'}
            </button>
            <button
              type="button"
              className="cc-btn cc-btn--secondary"
              onClick={() => void openFolder('log')}
            >
              Open log folder
            </button>
            <button
              type="button"
              className="cc-btn cc-btn--secondary"
              onClick={() => void openFolder('data')}
            >
              Open data folder
            </button>
          </div>
        </SettingsSection>

        <SettingsSection title="Connection recovery">
          <div className="cc-workspace-preference">
            <div>
              <div className="cc-workspace-card__name">Reset saved connections</div>
              <div className="cc-workspace-card__description">
                Sign out and remove remote workspace profiles. Tasks stored on this device are not
                deleted.
              </div>
            </div>
            <button
              type="button"
              className="cc-btn cc-btn--danger cc-btn--compact"
              onClick={resetConnections}
            >
              Reset connections
            </button>
          </div>
        </SettingsSection>
      </main>
      <ToastContainer />
    </div>
  );
}
