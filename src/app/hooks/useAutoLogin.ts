import { useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { IS_ELECTRON } from '../types/platform';

/**
 * Auto-login on Electron in host mode by reading server config from the main process.
 * In client mode, the user logs in manually — auto-login is skipped.
 */
export function useAutoLogin() {
  const token = useAuthStore((s) => s.token);
  const isLoading = useAuthStore((s) => s.isLoading);
  const login = useAuthStore((s) => s.login);
  const loginInFlight = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  const tryLogin = useCallback(async () => {
    if (useAuthStore.getState().token || loginInFlight.current) return;

    const status = await window.electronAPI.server.getStatus();
    if (status.state === 'stopped' || status.state === 'error') return;

    loginInFlight.current = true;
    try {
      useAuthStore.setState({ serverUrl: null, token: null, refreshToken: null });

      const config = await window.electronAPI.server.getConfig();
      const url = `http://localhost:${config.port}`;
      await login(url, config.pin);
    } catch (err) {
      console.error('Auto-login failed:', err);
    } finally {
      loginInFlight.current = false;
    }
  }, [login]);

  useEffect(() => {
    if (!IS_ELECTRON || isLoading || token) return;

    // Only auto-login in host mode (local server available)
    window.electronAPI.server.getAppMode().then((mode) => {
      if (mode !== 'host') return;

      tryLogin();

      const cleanup = window.electronAPI.server.onStatusChange((status) => {
        if (status.state === 'running' && !useAuthStore.getState().token) {
          tryLogin();
        }
      });
      cleanupRef.current = cleanup;
    });

    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [isLoading, token, tryLogin]);
}
