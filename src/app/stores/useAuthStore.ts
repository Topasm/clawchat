import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { secureStorage } from '../services/platform';

export type ConnectionStatus = 'demo' | 'connected' | 'disconnected' | 'reconnecting';

interface AuthState {
  token: string | null;
  refreshToken: string | null;
  serverUrl: string | null;
  isLoading: boolean;
  connectionStatus: ConnectionStatus;
  login: (serverUrl: string, pin: string) => Promise<void>;
  logout: () => void;
  setToken: (token: string) => void;
  setLoading: (isLoading: boolean) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      refreshToken: null,
      serverUrl: null,
      isLoading: true,
      connectionStatus: 'demo' as ConnectionStatus,

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
          isLoading: false,
        });
      },

      logout: () => {
        set({
          token: null,
          refreshToken: null,
          serverUrl: null,
          connectionStatus: 'demo' as ConnectionStatus,
        });
        // Reset module and chat stores back to demo data (lazy import to avoid circular deps)
        import('./useModuleStore').then((m) => m.useModuleStore.getState().resetToDemo());
        import('./useChatStore').then((m) => m.useChatStore.getState().resetToDemo());
      },

      setToken: (token: string) => set({ token }),

      setLoading: (isLoading: boolean) => set({ isLoading }),

      setConnectionStatus: (connectionStatus: ConnectionStatus) => set({ connectionStatus }),
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
      onRehydrateStorage: () => (state) => {
        state?.setLoading(false);
      },
    },
  ),
);
