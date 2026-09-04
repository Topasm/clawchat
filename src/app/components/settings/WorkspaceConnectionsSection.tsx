import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
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
  const [localSecurityError, setLocalSecurityError] = useState('');
  const [name, setName] = useState('');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState<'local' | 'remote' | null>(null);
  const [connectionError, setConnectionError] = useState('');
  const [serverError, setServerError] = useState('');
  const remoteFormRef = useRef<HTMLFormElement>(null);
  const remotePinInputRef = useRef<HTMLInputElement>(null);
  const localPinInputRef = useRef<HTMLInputElement>(null);
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
    setConnectionError('');
    try {
      await activateLocalWorkspace();
      addToast('success', translateUi('Using the private workspace on this device.'));
    } catch (cause) {
      setConnectionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }, [addToast]);
  const connectRemote = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setBusy('remote');
      setConnectionError('');
      try {
        const profile = await connectRemoteWorkspace({
          name,
          remoteUrl,
          pin,
          selectedProfileId,
        });
        setPin('');
        addToast('success', translateUi('Connected to {{name}}.', { name: profile.name }));
        setName('');
        setRemoteUrl('');
        setSelectedProfileId(null);
      } catch (cause) {
        setConnectionError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(null);
      }
    },
    [addToast, name, pin, remoteUrl, selectedProfileId],
  );
  const chooseRemote = async (profile: WorkspaceProfile) => {
    setName(profile.name);
    setRemoteUrl(profile.serverUrl ?? '');
    setSelectedProfileId(profile.id);
    setPin('');
    setConnectionError('');
    setBusy('remote');
    try {
      const activation = await activateSavedRemoteWorkspace(profile);
      if (activation.kind === 'needs-pin') {
        setConnectionError(translateUi('Enter the PIN for this workspace to connect.'));
        requestAnimationFrame(() => {
          remoteFormRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
          remotePinInputRef.current?.focus();
        });
        return;
      }
      addToast('success', translateUi('Connected to {{name}}.', { name: profile.name }));
    } catch (cause) {
      setConnectionError(
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
    setServerError('');
    try {
      await updateLocalServerPolicy({ autoStartHost: enabled });
      addToast(
        'success',
        translateUi(
          enabled ? 'ClawChat will open at system login.' : 'Launch at system login disabled.',
        ),
      );
    } catch (cause) {
      setServerError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const saveLocalSecurity = async (nextLanAccess = lanAccess, pinToSave = localPin) => {
    setSavingLocalSecurity(true);
    setServerError('');
    setLocalSecurityError('');
    try {
      await updateLocalServerPolicy({
        ...(pinToSave ? { pin: pinToSave } : {}),
        lanAccess: nextLanAccess,
      });
      setLocalPin('');
      addToast(
        'success',
        translateUi(
          nextLanAccess && pinToSave
            ? 'LAN access enabled with the updated PIN.'
            : nextLanAccess
              ? 'Local network access enabled.'
              : 'Local workspace security updated.',
        ),
      );
    } catch (cause) {
      setLocalSecurityError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSavingLocalSecurity(false);
    }
  };
  const focusLocalPin = () => {
    requestAnimationFrame(() => {
      localPinInputRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      localPinInputRef.current?.focus();
    });
  };
  const validLocalPin = /^\d{6,32}$/.test(localPin);
  const handleLanAccessToggle = (enabled: boolean) => {
    setLocalSecurityError('');
    if (!enabled) {
      // A half-entered replacement PIN must never prevent LAN access from
      // being disabled. Leave the draft in the field and only change policy.
      void saveLocalSecurity(false, '');
      return;
    }
    if (localPin && !validLocalPin) {
      setLocalSecurityError('Enter a PIN containing 6 to 32 digits before enabling local access.');
      focusLocalPin();
      return;
    }
    if (runtimeConfig?.defaultPinInUse && !validLocalPin) {
      setLocalSecurityError('Set a new 6 to 32 digit PIN before enabling local network access.');
      focusLocalPin();
      return;
    }
    void saveLocalSecurity(true, localPin);
  };
  const updateLocalLifecycle = async (updates: {
    localServerEnabled?: boolean;
    keepRunningInTray?: boolean;
  }) => {
    setServerError('');
    try {
      const result = await updateLocalServerPolicyForSession(updates);
      addToast(
        'success',
        result.leftActiveLocalWorkspace
          ? translateUi('Local server stopped. Choose another workspace to continue.')
          : translateUi('Local server policy updated.'),
      );
    } catch (cause) {
      setServerError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const savePort = async () => {
    const port = Number(localPort);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      setServerError(translateUi('Port must be Automatic (0) or a number between 1 and 65535.'));
      return;
    }
    setServerError('');
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
      setServerError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const autoStartHost = runtimeConfig?.autoStartHost ?? false;
  const lanAccess = runtimeConfig?.lanAccess ?? false;
  return (
    <>
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

        <form
          ref={remoteFormRef}
          className="cc-workspace-connect"
          onSubmit={(event) => void connectRemote(event)}
        >
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
                ref={remotePinInputRef}
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
          {connectionError && (
            <div className="cc-workspace-connect__message" role="alert">
              {connectionError}
            </div>
          )}
          <div className="cc-workspace-connect__actions">
            <span>
              {translateUi(
                'PINs are never saved. This device securely remembers the session until you sign out.',
              )}
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
      </SettingsSection>

      {runtimeConfig && (
        <SettingsSection title={translateUi('This device server')}>
          {serverError && (
            <div className="cc-workspace-connect__message" role="alert">
              {serverError}
            </div>
          )}
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
              {!runtimeConfig.localServerEnabled && (
                <div className="cc-settings-status cc-settings-status--subtle">
                  {translateUi('Turn on Local server before enabling local network access.')}
                </div>
              )}
              {runtimeConfig.localServerEnabled &&
                runtimeConfig.defaultPinInUse &&
                !lanAccess &&
                !localSecurityError && (
                  <div className="cc-settings-status cc-settings-status--subtle">
                    {translateUi(
                      'Set a new 6 to 32 digit PIN before enabling local network access.',
                    )}
                  </div>
                )}
              {savingLocalSecurity && (
                <div className="cc-settings-status cc-settings-status--subtle" role="status">
                  {translateUi('Restarting the local server…')}
                </div>
              )}
              {localSecurityError && (
                <div className="cc-settings-status cc-settings-status--error" role="alert">
                  {translateUi(localSecurityError)}
                </div>
              )}
            </div>
            <Toggle
              checked={lanAccess}
              disabled={savingLocalSecurity || !runtimeConfig.localServerEnabled}
              label={translateUi('Allow local network access')}
              onChange={handleLanAccessToggle}
            />
          </PropertyRow>
          <PropertyRow className="cc-workspace-preference">
            <label>
              <span className="cc-workspace-card__name">{translateUi('Local network PIN')}</span>
              <input
                ref={localPinInputRef}
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
                onChange={(event) => {
                  setLocalPin(event.target.value);
                  setLocalSecurityError('');
                }}
                autoComplete="new-password"
                aria-invalid={Boolean(localSecurityError)}
                disabled={!runtimeConfig.localServerEnabled}
              />
            </label>
            <button
              type="button"
              className="cc-btn cc-btn--secondary cc-btn--compact"
              disabled={savingLocalSecurity || !runtimeConfig.localServerEnabled || !validLocalPin}
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
        </SettingsSection>
      )}
    </>
  );
}
