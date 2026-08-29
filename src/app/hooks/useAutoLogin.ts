import { useEffect } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { useHostSessionStore } from '../stores/useHostSessionStore';

/**
 * Drive the desktop host handshake (start the watch, sign in with the stored
 * PIN) for as long as nobody is signed in.
 *
 * The state machine itself lives in `useHostSessionStore` so that the login
 * screen can render it without mounting a second copy of this effect. This
 * hook has exactly one caller — the router — and `start()` is idempotent, so
 * a re-render, a StrictMode double mount, or a second caller can never turn
 * into two concurrent sign-in attempts.
 */
export function useAutoLogin() {
  const token = useAuthStore((s) => s.token);
  const isLoading = useAuthStore((s) => s.isLoading);

  useEffect(() => {
    if (isLoading || token) return;

    void useHostSessionStore.getState().start();

    return () => {
      useHostSessionStore.getState().stop();
    };
  }, [isLoading, token]);
}
