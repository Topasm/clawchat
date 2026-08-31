import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { secureStorage } from '../services/platform';
import { clearQueryCache, getQueryCacheScope } from '../config/queryClient';

export type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting';

interface AuthState {
  token: string | null;
  refreshToken: string | null;
  serverUrl: string | null;
  hostId: string | null;
  hostPublicKey: string | null;
  relayUrl: string | null;
  isLoading: boolean;
  connectionStatus: ConnectionStatus;
  healthOK: boolean;
  login: (
    serverUrl: string,
    pin: string,
  ) => Promise<{
    hostId: string | null;
    hostPublicKey: string | null;
    apiVersion: string | null;
    workspaceName: string | null;
  }>;
  adoptSession: (
    serverUrl: string,
    session: { access_token: string; refresh_token?: string | null },
  ) => void;
  /** Clears auth immediately and resolves after session-scoped stores are reset. */
  logout: () => Promise<void>;
  setToken: (token: string) => void;
  setTokens: (token: string, refreshToken: string) => void;
  setLoading: (isLoading: boolean) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setHealthOK: (ok: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      refreshToken: null,
      serverUrl: null,
      hostId: null,
      hostPublicKey: null,
      relayUrl: null,
      isLoading: true,
      connectionStatus: 'disconnected' as ConnectionStatus,
      healthOK: true,

      login: async (serverUrl: string, pin: string) => {
        const response = await fetch(`${serverUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            errorData?.error?.message || 'Login failed. Check your server URL and PIN.',
          );
        }

        const data = await response.json();
        set({
          token: data.access_token,
          refreshToken: data.refresh_token,
          serverUrl,
          hostId: typeof data.host_id === 'string' ? data.host_id : null,
          hostPublicKey: typeof data.host_public_key === 'string' ? data.host_public_key : null,
          relayUrl: null,
          isLoading: false,
        });
        return {
          hostId: typeof data.host_id === 'string' ? data.host_id : null,
          hostPublicKey: typeof data.host_public_key === 'string' ? data.host_public_key : null,
          apiVersion: typeof data.api_version === 'string' ? data.api_version : null,
          workspaceName: typeof data.workspace_name === 'string' ? data.workspace_name : null,
        };
      },

      adoptSession: (serverUrl, session) => {
        set({
          token: session.access_token,
          refreshToken: session.refresh_token ?? null,
          serverUrl,
          hostId: null,
          hostPublicKey: null,
          relayUrl: null,
          isLoading: false,
        });
      },

      logout: () => {
        const { serverUrl, token, refreshToken } = get();
        // Explicit sign-out and confirmed refresh failures must also remove the
        // per-workspace credential. Otherwise selecting the same workspace can
        // silently restore a session the user believed they had forgotten.
        const forgetRememberedSession = import('../services/activeRemoteSession')
          .then(({ forgetActiveRemoteWorkspaceSession }) => forgetActiveRemoteWorkspaceSession())
          .catch((error) => {
            console.warn('Could not forget the active workspace session.', error);
          });
        if (serverUrl && token) {
          // Revoke the server-side refresh session without delaying local
          // sign-out. keepalive lets the request survive an app/webview close.
          void fetch(`${serverUrl}/api/auth/logout`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ refresh_token: refreshToken }),
            keepalive: true,
          }).catch(() => {
            // Local logout must still succeed while the server is unreachable.
          });
        }
        clearQueryCache(getQueryCacheScope(get()));
        // Keep pending offline work under its server/principal scope. It can be
        // replayed only after the same principal signs in to the same server.
        set({
          token: null,
          refreshToken: null,
          serverUrl: null,
          hostId: null,
          hostPublicKey: null,
          relayUrl: null,
          connectionStatus: 'disconnected' as ConnectionStatus,
        });
        // Reset module and chat stores lazily to avoid circular dependencies.
        // Return the work so tests and coordinated workspace transitions can
        // wait for it instead of leaving imports alive past environment teardown.
        const resetModuleStore = import('./useModuleStore')
          .then((module) => module.useModuleStore.getState().resetToDemo())
          .catch((error) => {
            console.warn('Could not reset the module store during logout.', error);
          });
        const resetChatStore = import('./useChatStore')
          .then((module) => module.useChatStore.getState().resetToDemo())
          .catch((error) => {
            console.warn('Could not reset the chat store during logout.', error);
          });

        return Promise.all([forgetRememberedSession, resetModuleStore, resetChatStore]).then(
          () => undefined,
        );
      },

      setToken: (token: string) => set({ token }),

      setTokens: (token: string, refreshToken: string) => set({ token, refreshToken }),

      setLoading: (isLoading: boolean) => set({ isLoading }),

      setConnectionStatus: (connectionStatus: ConnectionStatus) => set({ connectionStatus }),

      setHealthOK: (ok: boolean) => set({ healthOK: ok }),
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => ({
        getItem: async (name: string) => {
          return secureStorage.get(name);
        },
        setItem: async (name: string, value: string) => {
          await secureStorage.set(name, value);
        },
        removeItem: async (name: string) => {
          await secureStorage.remove(name);
        },
      })),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.error('Auth store rehydration failed:', error);
        }
        if (state) {
          state.setLoading(false);
        } else {
          useAuthStore.setState({ isLoading: false });
        }
      },
    },
  ),
);
