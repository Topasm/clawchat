import { useEffect } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { useHostSessionStore } from '../stores/useHostSessionStore';

/**
 * Drive the desktop host handshake after persisted auth has rehydrated.
 *
 * A packaged local server creates a fresh JWT signing key whenever its
 * process starts.  A token restored from the previous app launch can
 * therefore look present while already being unusable.  The host handshake
 * deliberately runs even when a token was restored so it replaces that token
 * before any task or calendar query is allowed to run.
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
    if (isLoading) return;

    void useHostSessionStore.getState().start();

    return () => {
      useHostSessionStore.getState().stop();
    };
  }, [isLoading]);

  useEffect(() => {
    if (isLoading || token) return;
    const hostSession = useHostSessionStore.getState();
    if (hostSession.phase === 'connected') {
      // Host mode has no user-facing sign-out boundary. If another part of
      // the app clears the short-lived API token, silently reopen the local
      // session instead of leaving a PIN-less user on a dead-end screen.
      void hostSession.signIn();
    }
  }, [isLoading, token]);
}
