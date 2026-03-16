import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { IS_ELECTRON } from '../types/platform';

/**
 * Auto-login on Electron by reading server config from the main process.
 * Always runs on Electron when there's no valid token — clears stale auth and logs in fresh.
 */
export function useAutoLogin() {
  const token = useAuthStore((s) => s.token);
  const isLoading = useAuthStore((s) => s.isLoading);
  const login = useAuthStore((s) => s.login);
  const attempted = useRef(false);

  useEffect(() => {
    if (!IS_ELECTRON || isLoading || token || attempted.current) return;

    attempted.current = true;

    (async () => {
      try {
        // Clear any stale auth state before fresh login
        useAuthStore.setState({ serverUrl: null, token: null, refreshToken: null });

        const config = await window.electronAPI.server.getConfig();
        const url = `http://localhost:${config.port}`;
        await login(url, config.pin);
      } catch (err) {
        console.error('Auto-login failed:', err);
        // Reset so user sees login page instead of stuck splash
        useAuthStore.setState({ serverUrl: null });
      }
    })();
  }, [isLoading, token, login]);
}
