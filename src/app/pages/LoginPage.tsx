import { useState, useEffect, type FormEvent, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../config/ThemeContext';
import { useAuthStore } from '../stores/useAuthStore';
import { platformApi } from '../platform';
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

type HealthStatus = 'idle' | 'checking' | 'ok' | 'error';

export default function LoginPage() {
  const { colors } = useTheme();
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();

  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [healthStatus, setHealthStatus] = useState<HealthStatus>('idle');
  const [showServerUrl, setShowServerUrl] = useState(!IS_DESKTOP);
  const [showScanner, setShowScanner] = useState(false);
  const [desktopClientMode, setDesktopClientMode] = useState(false);
  const [switchingToHost, setSwitchingToHost] = useState(false);

  // On desktop client mode: show server URL + QR, pre-fill from stored hostServerUrl
  useEffect(() => {
    if (!IS_DESKTOP) return;
    platformApi.server.getAppMode().then((mode) => {
      if (mode === 'client') {
        setDesktopClientMode(true);
        setShowServerUrl(true);
        platformApi.server.getConfig().then((cfg) => {
          if (cfg.hostServerUrl) {
            setServerUrl(cfg.hostServerUrl);
          }
        });
      }
    });
  }, []);

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
    try {
      const config = await platformApi.server.setAppMode('host');
      const url = `http://localhost:${config.port}`;
      setServerUrl(url);
      await login(url, config.pin);
      navigate('/today');
    } catch (err) {
      logger.error('Could not start the local server', err);
      setError(
        err instanceof Error ? err.message : 'Could not start the local server on this computer.',
      );
      setSwitchingToHost(false);
    }
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
              const detail = (relayResponse.data as { detail?: string } | null)?.detail;
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
      setError('Invalid QR code');
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(serverUrl.replace(/\/+$/, ''), pin);
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
      const response = await fetch(`${url}/api/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      setHealthStatus(response.ok ? 'ok' : 'error');
    } catch {
      setHealthStatus('error');
    }
  }, [serverUrl]);

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
            checking...
          </span>
        );
      case 'ok':
        return (
          <span style={{ fontSize: 12, color: colors.success, marginLeft: 8 }}>
            Server reachable
          </span>
        );
      case 'error':
        return (
          <span style={{ fontSize: 12, color: colors.error, marginLeft: 8 }}>
            Server unreachable
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
        <h1 style={{ margin: '0 0 24px', fontSize: 24, fontWeight: 700, color: colors.primary }}>
          ClawChat
        </h1>

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
              Use this computer
            </div>
            <div
              style={{
                fontSize: 12,
                lineHeight: 1.5,
                color: colors.textSecondary,
                marginBottom: 14,
              }}
            >
              Run ClawChat's own server here. No pairing, no network access — everything stays on
              this machine.
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
              {switchingToHost ? 'Starting local server…' : 'Start local server'}
            </button>
          </div>
        )}

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
              Server URL
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
              style={{ fontSize: 11, color: colors.textTertiary, marginTop: -10, marginBottom: 16 }}
            >
              When ClawChat is opened through a reverse proxy or tunnel, leaving this as the current
              site URL is usually correct.
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
            <span style={{ fontSize: 12, color: colors.textTertiary }}>Server: {serverUrl}</span>
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
              Change
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
          PIN
        </label>
        <input
          type="password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="Enter your PIN"
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
          {loading ? 'Connecting...' : 'Login'}
        </button>

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
            Scan QR Code
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
