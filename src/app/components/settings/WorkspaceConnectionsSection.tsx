import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppMode } from '../../hooks/useAppMode';
import { platformApi, type ServerStatus } from '../../platform';
import { useAuthStore } from '../../stores/useAuthStore';
import { useHostSessionStore } from '../../stores/useHostSessionStore';
import { useToastStore } from '../../stores/useToastStore';
import {
  LOCAL_WORKSPACE_ID,
  normalizeWorkspaceUrl,
  useWorkspaceStore,
  type WorkspaceProfile,
} from '../../stores/useWorkspaceStore';
import SettingsSection from '../shared/SettingsSection';
import Toggle from '../shared/Toggle';

function statusLabel(status: ServerStatus | null): string {
  if (!status) return 'Preparing';
  if (status.state === 'running') return 'Ready';
  if (status.state === 'starting') return 'Preparing';
  if (status.state === 'stopped') return 'Stopped';
  return status.error || 'Needs attention';
}

export default function WorkspaceConnectionsSection() {
  const navigate = useNavigate();
  const { appMode, setAppMode } = useAppMode();
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const login = useAuthStore((state) => state.login);
  const profiles = useWorkspaceStore((state) => state.profiles);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const upsertRemote = useWorkspaceStore((state) => state.upsertRemote);
  const removeRemote = useWorkspaceStore((state) => state.removeRemote);
  const setActiveWorkspace = useWorkspaceStore((state) => state.setActiveWorkspace);
  const addToast = useToastStore((state) => state.addToast);
  const [localStatus, setLocalStatus] = useState<ServerStatus | null>(null);
  const [autoStartHost, setAutoStartHost] = useState(false);
  const [name, setName] = useState('');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState<'local' | 'remote' | null>(null);
  const [error, setError] = useState('');

  const remoteProfiles = useMemo(
    () => profiles.filter((profile) => profile.kind === 'remote'),
    [profiles],
  );

  useEffect(() => {
    void platformApi.server.getStatus().then(setLocalStatus);
    void platformApi.server.getConfig().then((config) => setAutoStartHost(config.autoStartHost));
    return platformApi.server.onStatusChange(setLocalStatus);
  }, []);

  useEffect(() => {
    if (!appMode) return;
    if (appMode === 'host') {
      setActiveWorkspace(LOCAL_WORKSPACE_ID);
      return;
    }
    if (!serverUrl) return;
    const existing = remoteProfiles.find(
      (profile) => profile.serverUrl?.toLowerCase() === serverUrl.toLowerCase(),
    );
    if (existing) {
      setActiveWorkspace(existing.id);
      return;
    }
    let defaultName = 'Remote workspace';
    try {
      defaultName = new URL(serverUrl).hostname;
    } catch {
      // Keep a readable fallback for legacy stored URLs.
    }
    upsertRemote(defaultName, serverUrl);
  }, [appMode, remoteProfiles, serverUrl, setActiveWorkspace, upsertRemote]);

  const openLocalWorkspace = useCallback(async () => {
    if (appMode === 'host') return;
    setBusy('local');
    setError('');
    const hostSession = useHostSessionStore.getState();
    try {
      // Keep the working remote credentials until the local handshake has
      // succeeded. A broken sidecar can then be rolled back without signing
      // the user out of the workspace they were already using.
      hostSession.reset();
      await hostSession.retryHostStartup();
      if (useHostSessionStore.getState().phase !== 'connected') {
        throw new Error(
          useHostSessionStore.getState().failure?.message ||
            'The local workspace could not be opened.',
        );
      }
      setActiveWorkspace(LOCAL_WORKSPACE_ID);
      addToast('success', 'Using the private workspace on this Mac.');
      navigate('/today');
    } catch (cause) {
      try {
        await setAppMode('client');
      } catch {
        // Preserve the original startup error; the next retry can repair mode.
      }
      hostSession.deactivate();
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }, [addToast, appMode, navigate, setActiveWorkspace, setAppMode]);

  const connectRemote = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setBusy('remote');
      setError('');
      let normalizedUrl = '';
      try {
        normalizedUrl = normalizeWorkspaceUrl(remoteUrl);
        // Authenticate before stopping the local engine. A typo or wrong PIN
        // therefore leaves the current local workspace fully usable.
        await login(normalizedUrl, pin);
        await platformApi.server.updateConfig({ hostServerUrl: normalizedUrl });
        await setAppMode('client');
        useHostSessionStore.getState().deactivate();
        const profile = upsertRemote(name, normalizedUrl);
        setActiveWorkspace(profile.id);
        setPin('');
        addToast('success', `Connected to ${profile.name}.`);
        navigate('/today');
      } catch (cause) {
        // If native mode switching failed after remote authentication, restore
        // the invisible local session instead of mixing remote credentials
        // with a still-running local engine.
        if (normalizedUrl && useAuthStore.getState().serverUrl === normalizedUrl) {
          await useHostSessionStore.getState().retryHostStartup();
        }
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(null);
      }
    },
    [addToast, login, name, navigate, pin, remoteUrl, setActiveWorkspace, setAppMode, upsertRemote],
  );

  const chooseRemote = (profile: WorkspaceProfile) => {
    setName(profile.name);
    setRemoteUrl(profile.serverUrl ?? '');
    setPin('');
    setError('Enter the PIN for this workspace to connect.');
  };

  const handleAutoStartToggle = async (enabled: boolean) => {
    setError('');
    try {
      await platformApi.server.updateConfig({ autoStartHost: enabled });
      setAutoStartHost(enabled);
      addToast(
        'success',
        enabled ? 'ClawChat will open at Mac login.' : 'Launch at Mac login disabled.',
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <SettingsSection title="Workspaces & Connections">
      <div className="cc-workspace-card">
        <div className="cc-workspace-card__body">
          <div className="cc-workspace-card__heading">
            <span className="cc-workspace-card__name">This Mac</span>
            {appMode === 'host' && <span className="cc-workspace-badge">Current</span>}
          </div>
          <div className="cc-workspace-card__description">
            Private local tasks and calendar. No account, server address, or PIN required.
          </div>
          <div className="cc-workspace-card__meta">
            {statusLabel(localStatus)}
            {localStatus?.port ? ` · Local port ${localStatus.port}` : ''}
          </div>
        </div>
        {appMode !== 'host' && (
          <button
            type="button"
            className="cc-btn cc-btn--primary cc-btn--compact"
            disabled={busy !== null}
            onClick={() => void openLocalWorkspace()}
          >
            {busy === 'local' ? 'Opening…' : 'Use'}
          </button>
        )}
      </div>

      {remoteProfiles.map((profile) => (
        <div className="cc-workspace-card" key={profile.id}>
          <div className="cc-workspace-card__body">
            <div className="cc-workspace-card__heading">
              <span className="cc-workspace-card__name">{profile.name}</span>
              {appMode === 'client' && activeWorkspaceId === profile.id && (
                <span className="cc-workspace-badge">Current</span>
              )}
            </div>
            <div className="cc-workspace-card__description">{profile.serverUrl}</div>
            <div className="cc-workspace-card__meta">
              Remote workspace · PIN required to connect
            </div>
          </div>
          <div className="cc-settings-inline-actions">
            {!(appMode === 'client' && activeWorkspaceId === profile.id) && (
              <button
                type="button"
                className="cc-btn cc-btn--secondary cc-btn--compact"
                onClick={() => chooseRemote(profile)}
              >
                Use
              </button>
            )}
            {activeWorkspaceId !== profile.id && (
              <button
                type="button"
                className="cc-btn cc-btn--danger cc-btn--compact"
                onClick={() => removeRemote(profile.id)}
              >
                Remove
              </button>
            )}
          </div>
        </div>
      ))}

      <form className="cc-workspace-connect" onSubmit={(event) => void connectRemote(event)}>
        <div className="cc-workspace-connect__title">Add or connect to a remote workspace</div>
        <div className="cc-workspace-connect__grid">
          <label>
            <span>Name</span>
            <input
              className="cc-settings-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Home server"
            />
          </label>
          <label>
            <span>Server URL</span>
            <input
              className="cc-settings-input"
              type="url"
              required
              value={remoteUrl}
              onChange={(event) => setRemoteUrl(event.target.value)}
              placeholder="https://clawchat.example.com"
            />
          </label>
          <label>
            <span>PIN</span>
            <input
              className="cc-settings-input"
              type="password"
              required
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              placeholder="Not saved"
              autoComplete="current-password"
            />
          </label>
        </div>
        {error && <div className="cc-workspace-connect__message">{error}</div>}
        <div className="cc-workspace-connect__actions">
          <span>Connection names and URLs are saved locally. PINs are never saved.</span>
          <button
            type="submit"
            className="cc-btn cc-btn--secondary cc-btn--compact"
            disabled={busy !== null}
          >
            {busy === 'remote' ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      </form>

      {appMode === 'host' && (
        <div className="cc-workspace-preference">
          <div>
            <div className="cc-workspace-card__name">Open at Mac login</div>
            <div className="cc-workspace-card__description">
              Launch ClawChat and make the local workspace available after signing in to macOS.
            </div>
          </div>
          <Toggle checked={autoStartHost} onChange={handleAutoStartToggle} />
        </div>
      )}
    </SettingsSection>
  );
}
