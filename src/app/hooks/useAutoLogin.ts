import { useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { platformApi } from '../platform';
import { IS_DESKTOP } from '../types/platform';
import { logger } from '../services/logger';

/**
 * Auto-login on a desktop host by reading server config from the native platform adapter.
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

    const status = await platformApi.server.getStatus();
    if (status.state === 'stopped' || status.state === 'error') return;

    loginInFlight.current = true;
    try {
      const config = await platformApi.server.getConfig();
      const url = `http://localhost:${config.port}`;
      // Only drop stored credentials once we know where we are logging in and
      // are about to replace them. Clearing up front used to destroy a working
      // session whenever the local host happened to be unreachable.
      await login(url, config.pin);
    } catch (err) {
      logger.error('Auto-login failed:', err);
    } finally {
      loginInFlight.current = false;
    }
  }, [login]);

  useEffect(() => {
    if (!IS_DESKTOP || isLoading || token) return;

    let cancelled = false;

    // Only auto-login in host mode (local server available)
    platformApi.server
      .getAppMode()
      .then((mode) => {
        if (cancelled || mode !== 'host') return;

        void tryLogin();

        // The sidecar is usually still booting on a cold start, so retry once
        // it reports itself running.
        cleanupRef.current = platformApi.server.onStatusChange((status) => {
          if (status.state === 'running' && !useAuthStore.getState().token) {
            void tryLogin();
          }
        });
      })
      .catch((err: unknown) => {
        // No native server bridge (plain web build) — manual login applies.
        logger.debug('Auto-login unavailable:', err);
      });

    return () => {
      cancelled = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [isLoading, token, tryLogin]);
}
