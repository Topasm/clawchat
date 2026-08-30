import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { type ServerStatus } from '../../platform';
import { useAuthStore } from '../../stores/useAuthStore';
import { useToastStore } from '../../stores/useToastStore';
import {
  LOCAL_WORKSPACE_ID,
  useWorkspaceStore,
  type WorkspaceProfile,
} from '../../stores/useWorkspaceStore';
import SettingsSection from '../shared/SettingsSection';
import Toggle from '../shared/Toggle';
import { ListRow, PropertyRow } from '../shared/WorkspacePrimitives';
import { useWorkspaceRuntimeStore } from '../../stores/useWorkspaceRuntimeStore';
import {
  activateLocalWorkspace,
  activateSavedRemoteWorkspace,
  connectRemoteWorkspace,
  reconcileWorkspaceFromAuth,
  removeRemoteWorkspace,
  updateLocalServerPolicyForSession,
} from '../../services/workspaceSessionCoordinator';
import { translateUi } from '../../i18n';
function statusLabel(status: ServerStatus | null): string {
  if (!status) return translateUi('Preparing');
  if (status.state === 'running') return translateUi('Ready');
  if (status.state === 'starting') return translateUi('Preparing');
  if (status.state === 'stopped') return translateUi('Stopped');
  return status.error || translateUi('Needs attention');
}
export default function WorkspaceConnectionsSection() {
  const navigate = useNavigate();
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const profiles = useWorkspaceStore((state) => state.profiles);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const addToast = useToastStore((state) => state.addToast);
  const runtimeConfig = useWorkspaceRuntimeStore((state) => state.config);
  const localStatus = useWorkspaceRuntimeStore((state) => state.localServerStatus);
  const initializeRuntime = useWorkspaceRuntimeStore((state) => state.initialize);
  const refreshRuntime = useWorkspaceRuntimeStore((state) => state.refresh);
  const updateLocalServerPolicy = useWorkspaceRuntimeStore(
    (state) => state.updateLocalServerPolicy,
  );
  const [localPin, setLocalPin] = useState('');
  const [localPort, setLocalPort] = useState('0');
  const [savingLocalSecurity, setSavingLocalSecurity] = useState(false);
  const [name, setName] = useState('');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState<'local' | 'remote' | null>(null);
  const [error, setError] = useState('');
  const remoteProfiles = useMemo(
    () => profiles.filter((profile) => profile.kind === 'remote'),
    [profiles],
  );
  useEffect(() => {
    void initializeRuntime();
  }, [initializeRuntime]);
  useEffect(() => {
    if (!runtimeConfig) return;
    setLocalPort(String(runtimeConfig.port));
    reconcileWorkspaceFromAuth(serverUrl);
  }, [runtimeConfig, serverUrl]);
  const openLocalWorkspace = useCallback(async () => {
    setBusy('local');
    setError('');
    try {
      await activateLocalWorkspace();
      addToast('success', translateUi('Using the private workspace on this device.'));
      navigate('/today');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }, [addToast, navigate]);
  const connectRemote = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setBusy('remote');
      setError('');
      try {
        const profile = await connectRemoteWorkspace({
          name,
          remoteUrl,
          pin,
          selectedProfileId,
        });
        setPin('');
        addToast('success', translateUi('Connected to {{name}}.', { name: profile.name }));
        navigate('/today');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(null);
      }
    },
    [addToast, name, navigate, pin, remoteUrl, selectedProfileId],
  );
  const chooseRemote = async (profile: WorkspaceProfile) => {
    setName(profile.name);
    setRemoteUrl(profile.serverUrl ?? '');
    setSelectedProfileId(profile.id);
    setPin('');
    setError('');
    setBusy('remote');
    try {
      const activation = await activateSavedRemoteWorkspace(profile);
      if (activation.kind === 'needs-pin') {
        setError(translateUi('Enter the PIN for this workspace to connect.'));
        return;
      }
      addToast('success', translateUi('Connected to {{name}}.', { name: profile.name }));
      navigate('/today');
    } catch (cause) {
      setError(
        cause instanceof Error
          ? translateUi('{{message}} Enter the PIN to reconnect.', { message: cause.message })
          : translateUi('Enter the PIN for this workspace to reconnect.'),
      );
    } finally {
      setBusy(null);
    }
  };
  const deleteRemote = async (profile: WorkspaceProfile) => {
    await removeRemoteWorkspace(profile);
  };
  const handleAutoStartToggle = async (enabled: boolean) => {
    setError('');
    try {
      await updateLocalServerPolicy({ autoStartHost: enabled });
      addToast(
        'success',
        translateUi(
          enabled ? 'ClawChat will open at system login.' : 'Launch at system login disabled.',
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const saveLocalSecurity = async (nextLanAccess = lanAccess) => {
    setSavingLocalSecurity(true);
    setError('');
    try {
      await updateLocalServerPolicy({
        ...(localPin ? { pin: localPin } : {}),
        lanAccess: nextLanAccess,
      });
      setLocalPin('');
      addToast(
        'success',
        translateUi(
          nextLanAccess
            ? 'LAN access enabled with the updated PIN.'
            : 'Local workspace security updated.',
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSavingLocalSecurity(false);
    }
  };
  const updateLocalLifecycle = async (updates: {
    localServerEnabled?: boolean;
    keepRunningInTray?: boolean;
  }) => {
    setError('');
    try {
      const result = await updateLocalServerPolicyForSession(updates);
      if (result.leftActiveLocalWorkspace) navigate('/connections');
      addToast('success', translateUi('Local server policy updated.'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const savePort = async () => {
    const port = Number(localPort);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      setError(translateUi('Port must be Automatic (0) or a number between 1 and 65535.'));
      return;
    }
    setError('');
    try {
      await updateLocalServerPolicy({ port });
      await refreshRuntime();
      addToast(
        'success',
        port === 0
          ? translateUi('Automatic port selection enabled.')
          : translateUi('Local port set to {{port}}.', { port }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const autoStartHost = runtimeConfig?.autoStartHost ?? false;
  const lanAccess = runtimeConfig?.lanAccess ?? false;
  return (
    <SettingsSection title={translateUi('Workspaces & Connections')}>
      <ListRow className="cc-workspace-card">
        <div className="cc-workspace-card__body">
          <div className="cc-workspace-card__heading">
            <span className="cc-workspace-card__name">{translateUi('This device')}</span>
            {activeWorkspaceId === LOCAL_WORKSPACE_ID && (
              <span className="cc-workspace-badge">{translateUi('Current')}</span>
            )}
          </div>
          <div className="cc-workspace-card__description">
            {translateUi(
              '\n            Private local tasks and calendar. No account, server address, or PIN required.\n          ',
            )}
          </div>
          <div className="cc-workspace-card__meta">
            {statusLabel(localStatus)}
            {localStatus?.port
              ? translateUi(' · Local port {{port}}', { port: localStatus.port })
              : ''}
          </div>
        </div>
        {activeWorkspaceId !== LOCAL_WORKSPACE_ID && (
          <button
            type="button"
            className="cc-btn cc-btn--primary cc-btn--compact"
            disabled={busy !== null}
            onClick={() => void openLocalWorkspace()}
          >
            {busy === 'local' ? translateUi('Opening\u2026') : translateUi('Use')}
          </button>
        )}
      </ListRow>

      {remoteProfiles.map((profile) => (
        <ListRow className="cc-workspace-card" key={profile.id}>
          <div className="cc-workspace-card__body">
            <div className="cc-workspace-card__heading">
              <span className="cc-workspace-card__name">{profile.name}</span>
              {activeWorkspaceId === profile.id && (
                <span className="cc-workspace-badge">{translateUi('Current')}</span>
              )}
            </div>
            <div className="cc-workspace-card__description">{profile.serverUrl}</div>
            <div className="cc-workspace-card__meta">
              {translateUi(
                '\n              Remote workspace \u00B7 PIN required to connect\n            ',
              )}
            </div>
          </div>
          <div className="cc-settings-inline-actions">
            {activeWorkspaceId !== profile.id && (
              <button
                type="button"
                className="cc-btn cc-btn--secondary cc-btn--compact"
                onClick={() => void chooseRemote(profile)}
              >
                {translateUi('\n                Use\n              ')}
              </button>
            )}
            {activeWorkspaceId !== profile.id && (
              <button
                type="button"
                className="cc-btn cc-btn--danger cc-btn--compact"
                onClick={() => void deleteRemote(profile)}
              >
                {translateUi('\n                Remove\n              ')}
              </button>
            )}
          </div>
        </ListRow>
      ))}

      <form className="cc-workspace-connect" onSubmit={(event) => void connectRemote(event)}>
        <div className="cc-workspace-connect__title">
          {translateUi('Add or connect to a remote workspace')}
        </div>
        <div className="cc-workspace-connect__grid">
          <label>
            <span>{translateUi('Name')}</span>
            <input
              className="cc-settings-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={translateUi('Home server')}
            />
          </label>
          <label>
            <span>{translateUi('Server URL')}</span>
            <input
              className="cc-settings-input"
              type="url"
              required
              value={remoteUrl}
              onChange={(event) => {
                setRemoteUrl(event.target.value);
                setSelectedProfileId(null);
              }}
              placeholder={translateUi('https://clawchat.example.com')}
            />
          </label>
          <label>
            <span>{translateUi('PIN')}</span>
            <input
              className="cc-settings-input"
              type="password"
              required
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              placeholder={translateUi('Not saved')}
              autoComplete="current-password"
            />
          </label>
        </div>
        {error && <div className="cc-workspace-connect__message">{error}</div>}
        <div className="cc-workspace-connect__actions">
          <span>
            {translateUi('Connection names and URLs are saved locally. PINs are never saved.')}
          </span>
          <button
            type="submit"
            className="cc-btn cc-btn--secondary cc-btn--compact"
            disabled={busy !== null}
          >
            {busy === 'remote' ? translateUi('Connecting\u2026') : translateUi('Connect')}
          </button>
        </div>
      </form>

      {runtimeConfig && (
        <>
          <PropertyRow className="cc-workspace-preference">
            <div>
              <div className="cc-workspace-card__name">{translateUi('Local server')}</div>
              <div className="cc-workspace-card__description">
                {translateUi(
                  "\n                Make this device's private workspace available independently of the workspace shown\n                in this app.\n              ",
                )}
              </div>
            </div>
            <Toggle
              checked={runtimeConfig.localServerEnabled}
              label={translateUi('Local server')}
              onChange={(enabled) => void updateLocalLifecycle({ localServerEnabled: enabled })}
            />
          </PropertyRow>
          <PropertyRow className="cc-workspace-preference">
            <div>
              <div className="cc-workspace-card__name">{translateUi('Keep available in tray')}</div>
              <div className="cc-workspace-card__description">
                {translateUi(
                  '\n                Keep the local server running when the ClawChat window is closed.\n              ',
                )}
              </div>
            </div>
            <Toggle
              checked={runtimeConfig.keepRunningInTray}
              disabled={!runtimeConfig.localServerEnabled}
              label={translateUi('Keep available in tray')}
              onChange={(enabled) => void updateLocalLifecycle({ keepRunningInTray: enabled })}
            />
          </PropertyRow>
          <PropertyRow className="cc-workspace-preference">
            <div>
              <div className="cc-workspace-card__name">
                {translateUi('Allow local network access')}
              </div>
              <div className="cc-workspace-card__description">
                {translateUi(
                  '\n                Off keeps the bundled server on this device only. Turn it on to pair phones or other\n                computers on the same trusted network.\n              ',
                )}
              </div>
            </div>
            <Toggle
              checked={lanAccess}
              disabled={savingLocalSecurity || !runtimeConfig.localServerEnabled}
              label={translateUi('Allow local network access')}
              onChange={(enabled) => void saveLocalSecurity(enabled)}
            />
          </PropertyRow>
          <PropertyRow className="cc-workspace-preference">
            <label>
              <span className="cc-workspace-card__name">{translateUi('Local network PIN')}</span>
              <input
                className="cc-settings-input"
                type="password"
                inputMode="numeric"
                pattern="[0-9]{6,32}"
                minLength={6}
                maxLength={32}
                value={localPin}
                placeholder={
                  runtimeConfig.defaultPinInUse
                    ? translateUi('Replace the default PIN')
                    : translateUi('Enter a new PIN')
                }
                onChange={(event) => setLocalPin(event.target.value)}
                autoComplete="new-password"
                disabled={!runtimeConfig.localServerEnabled}
              />
            </label>
            <button
              type="button"
              className="cc-btn cc-btn--secondary cc-btn--compact"
              disabled={
                savingLocalSecurity || !runtimeConfig.localServerEnabled || localPin.length < 6
              }
              onClick={() => void saveLocalSecurity()}
            >
              {savingLocalSecurity ? translateUi('Saving\u2026') : translateUi('Save PIN')}
            </button>
          </PropertyRow>
          <PropertyRow className="cc-workspace-preference">
            <label>
              <span className="cc-workspace-card__name">{translateUi('Local server port')}</span>
              <span className="cc-workspace-card__description">
                {translateUi(
                  '\n                Use 0 for automatic selection, or choose a fixed port.\n              ',
                )}
              </span>
              <input
                className="cc-settings-input"
                type="number"
                min="0"
                max="65535"
                value={localPort}
                onChange={(event) => setLocalPort(event.target.value)}
                disabled={!runtimeConfig.localServerEnabled}
              />
            </label>
            <button
              type="button"
              className="cc-btn cc-btn--secondary cc-btn--compact"
              disabled={!runtimeConfig.localServerEnabled}
              onClick={() => void savePort()}
            >
              {translateUi('\n              Save port\n            ')}
            </button>
          </PropertyRow>
          <PropertyRow className="cc-workspace-preference">
            <div>
              <div className="cc-workspace-card__name">{translateUi('Open at system login')}</div>
              <div className="cc-workspace-card__description">
                {translateUi(
                  '\n                Launch ClawChat and make the local workspace available after signing in.\n              ',
                )}
              </div>
            </div>
            <Toggle
              checked={autoStartHost}
              disabled={!runtimeConfig.localServerEnabled}
              onChange={handleAutoStartToggle}
            />
          </PropertyRow>
        </>
      )}
    </SettingsSection>
  );
}
