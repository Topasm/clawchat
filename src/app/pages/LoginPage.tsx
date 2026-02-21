import { useState, type FormEvent, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../config/ThemeContext';
import { useAuthStore } from '../stores/useAuthStore';
import { DEFAULT_SERVER_URL } from '../config/constants';

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

  const handleSkipToDemo = () => {
    // Clear any existing auth so isDemoMode logic works
    useAuthStore.getState().logout();
    navigate('/today');
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

        <label style={{ display: 'flex', alignItems: 'center', marginBottom: 6, fontSize: 13, color: colors.textSecondary }}>
          Server URL
          {healthIndicator()}
        </label>
        <input
          type="url"
          value={serverUrl}
          onChange={(e) => { setServerUrl(e.target.value); setHealthStatus('idle'); }}
          onBlur={handleServerUrlBlur}
          placeholder="http://localhost:8000"
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

        <div
          style={{
            textAlign: 'center',
            marginTop: 16,
            paddingTop: 16,
            borderTop: `1px solid ${colors.border}`,
          }}
        >
          <button
            type="button"
            onClick={handleSkipToDemo}
            style={{
              background: 'none',
              border: 'none',
              color: colors.textSecondary,
              fontSize: 13,
              cursor: 'pointer',
              textDecoration: 'underline',
              padding: '4px 8px',
            }}
          >
            Skip to Demo Mode
          </button>
          <div style={{ fontSize: 11, color: colors.textTertiary, marginTop: 4 }}>
            Explore the app with sample data, no server needed
          </div>
        </div>
      </form>
    </div>
  );
}
