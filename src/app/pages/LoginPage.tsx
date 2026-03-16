import { useState, type FormEvent, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../config/ThemeContext';
import { useAuthStore } from '../stores/useAuthStore';
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
  const [showServerUrl, setShowServerUrl] = useState(!IS_ELECTRON);
  const [showScanner, setShowScanner] = useState(false);

  const handleQRScan = async (data: string) => {
    setShowScanner(false);
    try {
      const parsed = JSON.parse(data);
      if (parsed.serverUrl && parsed.pin) {
        setServerUrl(parsed.serverUrl);
        setPin(parsed.pin);
        // Auto-login
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
              When ClawChat is opened through Tailscale or a reverse proxy, leaving this as the current site URL is usually correct.
            </div>
          </>
        ) : (
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
        )}

        <label style={{ display: 'block', marginBottom: 6, fontSize: 13, color: colors.textSecondary }}>
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

        {!IS_ELECTRON && (
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
