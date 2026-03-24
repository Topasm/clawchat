import { useState, useEffect, type FormEvent, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../config/ThemeContext';
import { useAuthStore } from '../stores/useAuthStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { IS_ELECTRON, IS_CAPACITOR } from '../types/platform';
import { DEFAULT_SERVER_URL, DEFAULT_SERVER_URL_PLACEHOLDER } from '../config/constants';
import QRScanner from '../components/shared/QRScanner';

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
  const [showServerUrl, setShowServerUrl] = useState(!IS_ELECTRON && !IS_CAPACITOR);
  const [showScanner, setShowScanner] = useState(false);
  const [electronClientMode, setElectronClientMode] = useState(false);
  const biometricAttempted = useRef(false);
  const isPairingFirstMobile = IS_CAPACITOR;

  // Attempt biometric login on mount if enabled and token exists
  useEffect(() => {
    if (biometricAttempted.current) return;
    biometricAttempted.current = true;

    const biometricEnabled = useSettingsStore.getState().biometricEnabled;
    const storedToken = useAuthStore.getState().token;

    if (!IS_CAPACITOR || !biometricEnabled || !storedToken) return;

    (async () => {
      try {
        const { Capacitor } = await import('@capacitor/core');
        const Biometric = Capacitor.Plugins['Biometric'] as {
          authenticate(opts: { title: string; subtitle: string }): Promise<{ success: boolean }>;
        } | undefined;
        if (!Biometric) return;

        const result = await Biometric.authenticate({
          title: 'Unlock ClawChat',
          subtitle: 'Verify your identity to continue',
        });
        if (result.success) {
          navigate('/today');
        }
      } catch {
        // Biometric failed — fall through to PIN login
      }
    })();
  }, [navigate]);

  // On Electron client mode: show server URL + QR, pre-fill from stored hostServerUrl
  useEffect(() => {
    if (!IS_ELECTRON) return;
    window.electronAPI.server.getAppMode().then((mode) => {
      if (mode === 'client') {
        setElectronClientMode(true);
        setShowServerUrl(true);
        window.electronAPI.server.getConfig().then((cfg) => {
          if (cfg.hostServerUrl) {
            setServerUrl(cfg.hostServerUrl);
          }
        });
      }
    });
  }, []);

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
          const res = await fetch(`${pairUrl}/api/pairing/claim`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code: parsed.code,
              device_name: navigator.userAgent.includes('iPhone') ? 'iPhone' : 'Mobile Device',
              device_type: navigator.userAgent.includes('iPhone') ? 'ios' : 'android',
            }),
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData?.detail || 'Pairing failed');
          }
          const result = await res.json();
          // Store device token as access token and set server URL
          useAuthStore.setState({
            token: result.device_token,
            refreshToken: null,
            serverUrl: result.api_base_url || pairUrl,
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

        {isPairingFirstMobile && !showServerUrl && (
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
              Connect to your host desktop
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.5, color: colors.textSecondary, marginBottom: 14 }}>
              Scan the QR code shown on your main desktop. Manual server login is still available if you need it.
            </div>
            <button
              type="button"
              onClick={() => setShowScanner(true)}
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
              Scan Host QR
            </button>
            <button
              type="button"
              onClick={() => setShowServerUrl(true)}
              style={{
                width: '100%',
                padding: '10px 0',
                marginTop: 10,
                background: 'transparent',
                color: colors.textSecondary,
                border: `1px solid ${colors.border}`,
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Use Server URL Instead
            </button>
          </div>
        )}

        {showServerUrl ? (
          <>
            <label style={{ display: 'flex', alignItems: 'center', marginBottom: 6, fontSize: 13, color: colors.textSecondary }}>
              Server URL
              {healthIndicator()}
            </label>
            <input
              type="url"
              value={serverUrl}
              onChange={(e) => { setServerUrl(e.target.value); setHealthStatus('idle'); }}
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
            <div style={{ fontSize: 11, color: colors.textTertiary, marginTop: -10, marginBottom: 16 }}>
              When ClawChat is opened through a reverse proxy or tunnel, leaving this as the current site URL is usually correct.
            </div>
            {isPairingFirstMobile && (
              <button
                type="button"
                onClick={() => setShowServerUrl(false)}
                style={{
                  marginTop: -4,
                  marginBottom: 16,
                  padding: 0,
                  background: 'none',
                  border: 'none',
                  color: colors.textSecondary,
                  fontSize: 12,
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                Back to QR pairing
              </button>
            )}
          </>
        ) : !isPairingFirstMobile ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <span style={{ fontSize: 12, color: colors.textTertiary }}>
              Server: {serverUrl}
            </span>
            <button
              type="button"
              onClick={() => setShowServerUrl(true)}
              style={{ background: 'none', border: 'none', color: colors.textSecondary, fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}
            >
              Change
            </button>
          </div>
        ) : null}

        {(!isPairingFirstMobile || showServerUrl) && (
          <>
            <label style={{ display: 'block', marginBottom: 6, fontSize: 13, color: colors.textSecondary }}>
              PIN
            </label>
            <input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Enter your PIN"
              required={!isPairingFirstMobile || showServerUrl}
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
          </>
        )}

        {error && isPairingFirstMobile && !showServerUrl && (
          <div style={{ color: colors.error, fontSize: 13, marginTop: 16 }}>{error}</div>
        )}

        {(!IS_ELECTRON || electronClientMode) && !isPairingFirstMobile && (
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
        <QRScanner onScan={handleQRScan} onClose={() => setShowScanner(false)} />
      )}
    </div>
  );
}
