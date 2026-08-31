import { useAuthStore } from '../stores/useAuthStore';

interface RefreshResponse {
  access_token?: unknown;
  refresh_token?: unknown;
}

interface RefreshAttempt {
  serverUrl: string;
  refreshToken: string;
  promise: Promise<string>;
}

let activeAttempt: RefreshAttempt | null = null;

function isCurrentSession(serverUrl: string, refreshToken: string): boolean {
  const current = useAuthStore.getState();
  return current.serverUrl === serverUrl && current.refreshToken === refreshToken;
}

/**
 * Rotate the remembered refresh token exactly once, even when HTTP queries and
 * the WebSocket handshake discover an expired access token at the same time.
 *
 * Refresh tokens are single-use. Keeping this coordination outside both
 * transports prevents two simultaneous refresh requests from looking like a
 * replay attack and revoking an otherwise valid remembered session.
 */
export function refreshAuthSession(): Promise<string> {
  const { serverUrl, refreshToken } = useAuthStore.getState();
  if (!serverUrl || !refreshToken) {
    useAuthStore.getState().logout();
    return Promise.reject(new Error('No remembered session is available.'));
  }

  if (activeAttempt?.serverUrl === serverUrl && activeAttempt.refreshToken === refreshToken) {
    return activeAttempt.promise;
  }

  const promise = (async () => {
    try {
      const response = await fetch(`${serverUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!response.ok) {
        throw new Error(`Session refresh failed with status ${response.status}.`);
      }

      const data = (await response.json()) as RefreshResponse;
      if (typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string') {
        throw new Error('Session refresh returned invalid credentials.');
      }
      if (!isCurrentSession(serverUrl, refreshToken)) {
        throw new Error('The active workspace changed while the session was refreshing.');
      }

      useAuthStore.getState().setTokens(data.access_token, data.refresh_token);
      return data.access_token;
    } catch (error) {
      // A stale request from a workspace the user already left must never sign
      // the newly selected workspace out.
      if (isCurrentSession(serverUrl, refreshToken)) {
        useAuthStore.getState().logout();
      }
      throw error;
    }
  })();

  const attempt = { serverUrl, refreshToken, promise };
  activeAttempt = attempt;
  void promise
    .finally(() => {
      if (activeAttempt === attempt) activeAttempt = null;
    })
    .catch(() => {
      // The original caller receives the rejection. This branch only marks the
      // cleanup promise as handled.
    });
  return promise;
}
