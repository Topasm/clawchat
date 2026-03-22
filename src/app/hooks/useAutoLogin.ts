import { useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { IS_ELECTRON } from '../types/platform';

/**
 * Auto-login on Electron by reading server config from the main process.
 * Listens for server status events and retries login when the server becomes ready.
 */
export function useAutoLogin() {
  const token = useAuthStore((s) => s.token);
  const isLoading = useAuthStore((s) => s.isLoading);
  const login = useAuthStore((s) => s.login);
  const loginInFlight = useRef(false);

  const tryLogin = useCallback(async () => {
    // Skip if already logged in or a login attempt is in progress
    if (useAuthStore.getState().token || loginInFlight.current) return;

    // Skip auto-login if no embedded server (dev mode)
    const status = await window.electronAPI.server.getStatus();
    if (status.state === 'stopped' || status.state === 'error') return;

    loginInFlight.current = true;
    try {
      // Clear any stale auth state before fresh login
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

    // Try immediately — server may already be running
    tryLogin();

    // Also listen for server becoming ready (in case server wasn't up yet)
    const cleanup = window.electronAPI.server.onStatusChange((status) => {
      if (status.state === 'running' && !useAuthStore.getState().token) {
        tryLogin();
      }
    });

    return cleanup;
  }, [isLoading, token, tryLogin]);
}
