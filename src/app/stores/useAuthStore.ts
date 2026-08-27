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
  login: (serverUrl: string, pin: string) => Promise<void>;
  logout: () => void;
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
          hostId: null,
          hostPublicKey: null,
          relayUrl: null,
          isLoading: false,
        });
      },

      logout: () => {
        const { serverUrl, token, refreshToken } = get();
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
        // Reset module and chat stores (lazy import to avoid circular deps)
        import('./useModuleStore').then((m) => m.useModuleStore.getState().resetToDemo());
        import('./useChatStore').then((m) => m.useChatStore.getState().resetToDemo());
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
