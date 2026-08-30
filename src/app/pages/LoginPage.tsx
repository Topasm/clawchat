import { useState, useEffect, type FormEvent, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../config/ThemeContext';
import { useAuthStore } from '../stores/useAuthStore';
import { IS_DESKTOP } from '../types/platform';
import { relayClient } from '../services/relayClient';
interface PairingClaimResult {
  device_token: string;
  api_base_url?: string;
  host_id?: string;
  host_public_key?: string;
  relay_url?: string;
}
import { DEFAULT_SERVER_URL, DEFAULT_SERVER_URL_PLACEHOLDER } from '../config/constants';
import QRScanner from '../components/shared/QRScanner';
import { logger } from '../services/logger';
import { describeStartupLogLocation } from '../services/startupDiagnostics';
import {
  useHostSessionStore,
  type HostLoginFailure,
  type HostSessionPhase,
} from '../stores/useHostSessionStore';
import type { ServerStatus } from '../platform';
import { LOCAL_WORKSPACE_ID, useWorkspaceStore } from '../stores/useWorkspaceStore';
import { verifyClawChatHealth } from '../services/workspaceHealth';
import { translateUi } from '../i18n';
type HealthStatus = 'idle' | 'checking' | 'ok' | 'error';
/**
 * Turn a dead-end host handshake into something a user can act on.
 *
 * The server status carries the only machine-readable reason a packaged app
 * has (a blocked legacy import, a missing server binary, a failed health
 * check), and it used to be dropped on the floor — the user just got a PIN
 * form that could never succeed. Show it verbatim.
 */
export function describeHostBlock(
  status: ServerStatus | null,
  failure: HostLoginFailure | null,
): string {
  const reasons: string[] = [];
  if (status?.error) reasons.push(status.error);
  if (failure) {
    const headline =
      failure.kind === 'unreachable'
        ? 'The local server did not answer.'
        : failure.kind === 'rejected'
          ? 'The local server refused the saved PIN.'
          : 'Sign-in failed.';
    reasons.push(failure.message ? `${headline} ${failure.message}` : headline);
  }
  if (reasons.length === 0) {
    reasons.push('The local server is not running, and it did not report a reason.');
  }
  return reasons.join(' ');
}
const HOST_PHASE_HEADINGS: Record<HostSessionPhase, string> = {
  idle: 'Sign in',
  checking: 'Preparing ClawChat',
  starting: 'Preparing your local workspace',
  connecting: 'Opening your workspace',
  connected: 'Workspace ready',
  blocked: 'ClawChat could not open its local workspace',
};
const HOST_PHASE_DETAILS: Record<HostSessionPhase, string> = {
  idle: '',
  checking: 'Checking the private workspace stored on this device.',
  starting:
    'ClawChat is preparing local storage for your tasks and calendar. This usually takes a few seconds.',
  connecting: 'No account or PIN is needed. Taking you straight to your workspace.',
  connected: 'Taking you to your workspace.',
  blocked: '',
};
export default function LoginPage() {
  const { colors } = useTheme();
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const profiles = useWorkspaceStore((state) => state.profiles);
  const setActiveWorkspace = useWorkspaceStore((state) => state.setActiveWorkspace);
  const upsertRemote = useWorkspaceStore((state) => state.upsertRemote);
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [healthStatus, setHealthStatus] = useState<HealthStatus>('idle');
  const [showServerUrl, setShowServerUrl] = useState(!IS_DESKTOP);
  const [showScanner, setShowScanner] = useState(false);
  const [desktopClientMode, setDesktopClientMode] = useState(false);
  const [switchingToHost, setSwitchingToHost] = useState(false);
  const [showManualLogin, setShowManualLogin] = useState(false);
  // The host handshake is owned by the store so that reading it here cannot
  // start a second auto-login alongside the router's.
  const hostPhase = useHostSessionStore((s) => s.phase);
  const hostStatus = useHostSessionStore((s) => s.status);
  const hostFailure = useHostSessionStore((s) => s.failure);
  const isHostMode = useHostSessionStore((s) => s.isHostMode);
  const retryHostStartup = useHostSessionStore((s) => s.retryHostStartup);
  /**
   * A desktop host install must never be met by a bare PIN form: the server
   * it would authenticate against may not even be running, and nothing on
   * screen would say so.
   */
  const hostPanelActive =
    IS_DESKTOP && !desktopClientMode && (isHostMode || hostPhase === 'checking');
  const showCredentialFields = !hostPanelActive || showManualLogin;
  const startupLog = describeStartupLogLocation();
  /**
   * Reveal the manual fallback pointed at the local server.
   *
   * `DEFAULT_SERVER_URL` falls back to the page origin, which inside the
   * packaged shell is the `tauri://` scheme — useless as a login target. The
   * status tells us the port the sidecar was asked to use, so seed that.
   */
  const toggleManualLogin = () => {
    const next = !showManualLogin;
    setShowManualLogin(next);
    if (next && hostStatus) setServerUrl(`http://localhost:${hostStatus.port}`);
  };
  // A remote workspace selection controls what the renderer connects to. It
  // does not control whether this computer continues hosting in the tray.
  useEffect(() => {
    if (!IS_DESKTOP) return;
    const activeProfile = profiles.find((profile) => profile.id === activeWorkspaceId);
    const isRemote = activeProfile?.kind === 'remote';
    setDesktopClientMode(isRemote);
    if (isRemote) {
      setShowServerUrl(true);
      if (activeProfile.serverUrl) setServerUrl(activeProfile.serverUrl);
    }
  }, [activeWorkspaceId, profiles]);
  /**
   * Switch the desktop app to hosting its own server and log straight in.
   *
   * Without this, a desktop install that starts in client mode can only be
   * unlocked by pairing with another machine — so a failed camera or an
   * unreachable host leaves no way into the app at all.
   */
  const handleUseThisComputer = async () => {
    setSwitchingToHost(true);
    setError('');
    // Switching the mode only *asks* the shell to boot the sidecar. Signing in
    // immediately afterwards used to race a server that had not bound its port
    // yet, so wait for the status to settle and report what it settled on.
    await retryHostStartup();
    const { phase, status, failure } = useHostSessionStore.getState();
    if (phase === 'connected') {
      setActiveWorkspace(LOCAL_WORKSPACE_ID);
      navigate('/today');
      return;
    }
    if (status) setServerUrl(`http://localhost:${status.port}`);
    const reason = describeHostBlock(status, failure);
    logger.error('Could not start the local server', reason);
    setError(reason);
    setSwitchingToHost(false);
  };
  const handleQRScan = async (data: string) => {
    setShowScanner(false);
    try {
      const parsed = JSON.parse(data);
      if (parsed.type === 'clawchat_pair' && parsed.server_url && parsed.code) {
        // Unified pairing flow: claim the pairing code for a device token
        const pairUrl = parsed.server_url.replace(/\/+$/, '');
        setServerUrl(pairUrl);
        setLoading(true);
        setError('');
        try {
          const claimBody = JSON.stringify({
            code: parsed.code,
            device_name: navigator.userAgent.includes('iPhone') ? 'iPhone' : 'Mobile Device',
            device_type: navigator.userAgent.includes('iPhone') ? 'ios' : 'android',
          });
          let result: PairingClaimResult;
          try {
            const directController = new AbortController();
            const directTimeout = setTimeout(() => directController.abort(), 4000);
            let res: Response;
            try {
              res = await fetch(`${pairUrl}/api/pairing/claim`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: claimBody,
                signal: directController.signal,
              });
            } finally {
              clearTimeout(directTimeout);
            }
            if (!res.ok) {
              const errData = await res.json().catch(() => ({}));
              throw new Error(errData?.detail || 'Pairing failed');
            }
            result = (await res.json()) as PairingClaimResult;
          } catch (directError) {
            const relayConfig = {
              relayUrl: parsed.relay_url,
              hostId: parsed.host_id,
              hostPublicKey: parsed.host_public_key,
            };
            if (!relayClient.isConfigured(relayConfig)) throw directError;
            const relayResponse = await relayClient.request(relayConfig, {
              method: 'POST',
              path: '/api/pairing/claim',
              headers: { 'content-type': 'application/json' },
              body: claimBody,
            });
            if (relayResponse.status >= 400) {
              const detail = (
                relayResponse.data as {
                  detail?: string;
                } | null
              )?.detail;
              throw new Error(detail || 'Pairing failed through relay', { cause: directError });
            }
            result = relayResponse.data as PairingClaimResult;
          }
          if (parsed.host_public_key && result.host_public_key !== parsed.host_public_key) {
            throw new Error('Host identity did not match the scanned QR code');
          }
          if (parsed.host_id && result.host_id !== parsed.host_id) {
            throw new Error('Host ID did not match the scanned QR code');
          }
          // Store device token as access token and set server URL
          useAuthStore.setState({
            token: result.device_token,
            refreshToken: null,
            serverUrl: result.api_base_url || pairUrl,
            hostId: result.host_id ?? parsed.host_id ?? null,
            hostPublicKey: result.host_public_key ?? parsed.host_public_key ?? null,
            relayUrl: result.relay_url ?? parsed.relay_url ?? null,
            isLoading: false,
          });
          upsertRemote('Remote workspace', result.api_base_url || pairUrl, {
            hostId: result.host_id ?? parsed.host_id,
            hostPublicKey: result.host_public_key ?? parsed.host_public_key,
            apiVersion: '1',
          });
          navigate('/today');
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setLoading(false);
        }
      } else if (parsed.serverUrl && parsed.pin) {
        // Legacy PIN-based QR
        setServerUrl(parsed.serverUrl);
        setPin(parsed.pin);
        setLoading(true);
        setError('');
        try {
          await login(parsed.serverUrl.replace(/\/+$/, ''), parsed.pin);
          navigate('/today');
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setLoading(false);
        }
      }
    } catch {
      setError(translateUi('Invalid QR code'));
    }
  };
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const normalizedUrl = serverUrl.replace(/\/+$/, '');
      const activeProfile = profiles.find((profile) => profile.id === activeWorkspaceId);
      const health = await verifyClawChatHealth(
        normalizedUrl,
        activeProfile?.kind === 'remote' ? activeProfile.hostId : null,
      );
      const identity = await login(normalizedUrl, pin);
      if (identity.hostId && identity.hostId !== health.hostId) {
        throw new Error('The server identity changed between health check and sign-in.');
      }
      if (!IS_DESKTOP || desktopClientMode) {
        upsertRemote(identity.workspaceName || '', normalizedUrl, {
          hostId: health.hostId,
          hostPublicKey: identity.hostPublicKey ?? health.hostPublicKey,
          apiVersion: identity.apiVersion ?? health.apiVersion,
        });
      }
      navigate('/today');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };
  const checkHealth = useCallback(async () => {
    const url = serverUrl.replace(/\/+$/, '');
    if (!url) {
      setHealthStatus('idle');
      return;
    }
    setHealthStatus('checking');
    try {
      const activeProfile = profiles.find((profile) => profile.id === activeWorkspaceId);
      await verifyClawChatHealth(url, activeProfile?.hostId);
      setHealthStatus('ok');
    } catch {
      setHealthStatus('error');
    }
  }, [activeWorkspaceId, profiles, serverUrl]);
  const handleServerUrlBlur = () => {
    if (serverUrl.trim()) {
      checkHealth();
    }
  };
  const healthIndicator = () => {
    switch (healthStatus) {
      case 'checking':
        return (
          <span style={{ fontSize: 12, color: colors.textTertiary, marginLeft: 8 }}>
            {translateUi('\n            checking...\n          ')}
          </span>
        );
      case 'ok':
        return (
          <span style={{ fontSize: 12, color: colors.success, marginLeft: 8 }}>
            {translateUi('\n            Server reachable\n          ')}
          </span>
        );
      case 'error':
        return (
          <span style={{ fontSize: 12, color: colors.error, marginLeft: 8 }}>
            {translateUi('\n            Server unreachable\n          ')}
          </span>
        );
      default:
        return null;
    }
  };
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: colors.background,
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: colors.surface,
          padding: 32,
          borderRadius: 12,
          width: 360,
          boxShadow: `0 2px 12px ${colors.shadow}22`,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 24,
          }}
        >
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: colors.primary }}>
            {translateUi('\n            ClawChat\n          ')}
          </h1>
          {IS_DESKTOP && (
            <button
              type="button"
              aria-label={translateUi('Open connections')}
              onClick={() => navigate('/connections')}
              style={{
                padding: '6px 9px',
                border: `1px solid ${colors.border}`,
                borderRadius: 8,
                color: colors.textSecondary,
                background: colors.background,
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              {translateUi('\n              Connections\n            ')}
            </button>
          )}
        </div>

        {hostPanelActive && (
          <div
            data-testid="host-startup-panel"
            style={{
              marginBottom: 20,
              padding: '14px 16px',
              borderRadius: 10,
              background: colors.background,
              border: `1px solid ${colors.border}`,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 6 }}>
              {HOST_PHASE_HEADINGS[hostPhase]}
            </div>
            {hostPhase === 'blocked' ? (
              <>
                <div
                  style={{
                    fontSize: 12,
                    lineHeight: 1.5,
                    color: colors.textSecondary,
                    marginBottom: 10,
                  }}
                >
                  {translateUi(
                    '\n                  Your tasks and calendar stay on this device. ClawChat could not prepare that local\n                  workspace yet.\n                ',
                  )}
                </div>
                <div
                  data-testid="host-startup-reason"
                  style={{
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    fontSize: 11,
                    lineHeight: 1.5,
                    color: colors.error,
                    background: colors.surface,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 8,
                    padding: '8px 10px',
                    marginBottom: 10,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {describeHostBlock(hostStatus, hostFailure)}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    lineHeight: 1.5,
                    color: colors.textTertiary,
                    marginBottom: 12,
                  }}
                >
                  {translateUi('\n                  Startup records are kept in ')}
                  {startupLog.startupLog}
                  {translateUi(", and the server's own output\n                  in ")}
                  {startupLog.serverLog}.
                </div>
                <button
                  type="button"
                  onClick={() => void retryHostStartup()}
                  style={{
                    width: '100%',
                    padding: '12px 0',
                    background: colors.primary,
                    color: '#fff',
                    border: 'none',
                    borderRadius: 8,
                    fontSize: 15,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {translateUi(
                    '\n                  Try opening the workspace again\n                ',
                  )}
                </button>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button
                    type="button"
                    onClick={() => navigate('/connections')}
                    style={{
                      flex: 1,
                      padding: '9px 8px',
                      border: `1px solid ${colors.border}`,
                      borderRadius: 8,
                      color: colors.text,
                      background: colors.surface,
                      cursor: 'pointer',
                      fontSize: 11,
                    }}
                  >
                    {translateUi('\n                    Connect elsewhere\n                  ')}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate('/diagnostics')}
                    style={{
                      flex: 1,
                      padding: '9px 8px',
                      border: `1px solid ${colors.border}`,
                      borderRadius: 8,
                      color: colors.text,
                      background: colors.surface,
                      cursor: 'pointer',
                      fontSize: 11,
                    }}
                  >
                    {translateUi('\n                    Diagnostics\n                  ')}
                  </button>
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12, lineHeight: 1.5, color: colors.textSecondary }}>
                {HOST_PHASE_DETAILS[hostPhase]}
              </div>
            )}
            <button
              type="button"
              onClick={toggleManualLogin}
              style={{
                display: 'block',
                marginTop: 12,
                padding: 0,
                background: 'none',
                border: 'none',
                color: colors.textSecondary,
                fontSize: 11,
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              {showManualLogin
                ? translateUi('Hide manual sign-in')
                : translateUi('If this keeps happening, sign in manually')}
            </button>
          </div>
        )}

        {desktopClientMode && (
          <div
            style={{
              marginBottom: 20,
              padding: '14px 16px',
              borderRadius: 10,
              background: colors.background,
              border: `1px solid ${colors.border}`,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 6 }}>
              {translateUi('\n              Use this computer\n            ')}
            </div>
            <div
              style={{
                fontSize: 12,
                lineHeight: 1.5,
                color: colors.textSecondary,
                marginBottom: 14,
              }}
            >
              {translateUi(
                '\n              Keep tasks and calendar on this device. No server address, pairing, account, or PIN is\n              required.\n            ',
              )}
            </div>
            <button
              type="button"
              onClick={() => void handleUseThisComputer()}
              disabled={switchingToHost}
              style={{
                width: '100%',
                padding: '12px 0',
                background: colors.primary,
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontSize: 15,
                fontWeight: 600,
                cursor: switchingToHost ? 'default' : 'pointer',
                opacity: switchingToHost ? 0.7 : 1,
              }}
            >
              {switchingToHost
                ? translateUi('Preparing local workspace\u2026')
                : translateUi('Use local workspace')}
            </button>
          </div>
        )}

        {showCredentialFields && (
          <>
            {showServerUrl ? (
              <>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    marginBottom: 6,
                    fontSize: 13,
                    color: colors.textSecondary,
                  }}
                >
                  {translateUi('\n                  Server URL\n                  ')}
                  {healthIndicator()}
                </label>
                <input
                  type="url"
                  value={serverUrl}
                  onChange={(e) => {
                    setServerUrl(e.target.value);
                    setHealthStatus('idle');
                  }}
                  onBlur={handleServerUrlBlur}
                  placeholder={DEFAULT_SERVER_URL_PLACEHOLDER}
                  required
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    marginBottom: 16,
                    border: `1px solid ${healthStatus === 'ok' ? colors.success : healthStatus === 'error' ? colors.error : colors.border}`,
                    borderRadius: 8,
                    fontSize: 14,
                    background: colors.background,
                    color: colors.text,
                    boxSizing: 'border-box',
                    outline: 'none',
                    transition: 'border-color 0.2s',
                  }}
                />
                <div
                  style={{
                    fontSize: 11,
                    color: colors.textTertiary,
                    marginTop: -10,
                    marginBottom: 16,
                  }}
                >
                  {translateUi(
                    '\n                  When ClawChat is opened through a reverse proxy or tunnel, leaving this as the\n                  current site URL is usually correct.\n                ',
                  )}
                </div>
              </>
            ) : (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 16,
                }}
              >
                <span style={{ fontSize: 12, color: colors.textTertiary }}>
                  {translateUi('\n                  Server: ')}
                  {serverUrl}
                </span>
                <button
                  type="button"
                  onClick={() => setShowServerUrl(true)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: colors.textSecondary,
                    fontSize: 11,
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  {translateUi('\n                  Change\n                ')}
                </button>
              </div>
            )}

            <label
              style={{
                display: 'block',
                marginBottom: 6,
                fontSize: 13,
                color: colors.textSecondary,
              }}
            >
              {translateUi('\n              PIN\n            ')}
            </label>
            <input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder={translateUi('Enter your PIN')}
              required
              style={{
                width: '100%',
                padding: '10px 12px',
                marginBottom: 20,
                border: `1px solid ${colors.border}`,
                borderRadius: 8,
                fontSize: 14,
                background: colors.background,
                color: colors.text,
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />

            {error && (
              <div style={{ color: colors.error, fontSize: 13, marginBottom: 16 }}>{error}</div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '12px 0',
                background: loading ? colors.disabled : colors.primary,
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontSize: 15,
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? translateUi('Connecting...') : translateUi('Login')}
            </button>
          </>
        )}

        {(!IS_DESKTOP || desktopClientMode) && (
          <button
            type="button"
            onClick={() => setShowScanner(true)}
            style={{
              width: '100%',
              padding: '10px 0',
              marginTop: 10,
              background: 'transparent',
              color: colors.primary,
              border: `1px solid ${colors.primary}`,
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {translateUi('\n            Scan QR Code\n          ')}
          </button>
        )}
      </form>
      {showScanner && (
        <QRScanner
          onScan={handleQRScan}
          onClose={() => setShowScanner(false)}
          onManualEntry={() => {
            setShowScanner(false);
            setShowServerUrl(true);
          }}
        />
      )}
    </div>
  );
}
