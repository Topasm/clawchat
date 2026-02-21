import { useState, type FormEvent } from 'react';
import { useTheme } from '../config/ThemeContext';
import { useAuthStore } from '../stores/useAuthStore';
import { DEFAULT_SERVER_URL } from '../config/constants';

export default function LoginPage() {
  const { colors } = useTheme();
  const login = useAuthStore((s) => s.login);

  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(serverUrl.replace(/\/+$/, ''), pin);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
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

        <label style={{ display: 'block', marginBottom: 6, fontSize: 13, color: colors.textSecondary }}>
          Server URL
        </label>
        <input
          type="url"
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
          placeholder="http://localhost:8000"
          required
          style={{
            width: '100%',
            padding: '10px 12px',
            marginBottom: 16,
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            fontSize: 14,
            background: colors.background,
            color: colors.text,
            boxSizing: 'border-box',
            outline: 'none',
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
      </form>
    </div>
  );
}
