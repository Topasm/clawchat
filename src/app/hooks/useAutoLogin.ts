import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { IS_ELECTRON } from '../types/platform';

/**
 * Auto-login on Electron by reading server config from the main process.
 * Only runs when Electron + not authenticated.
 */
export function useAutoLogin() {
  const token = useAuthStore((s) => s.token);
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const login = useAuthStore((s) => s.login);
  const isLoading = useAuthStore((s) => s.isLoading);
  const attempted = useRef(false);

  useEffect(() => {
    if (!IS_ELECTRON || isLoading || token || attempted.current) return;

    attempted.current = true;

    (async () => {
      try {
        const config = await window.electronAPI.server.getConfig();
        const url = `http://localhost:${config.port}`;
        await login(url, config.pin);
      } catch (err) {
        console.error('Auto-login failed:', err);
      }
    })();
  }, [IS_ELECTRON, isLoading, token, login]);
}
