import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface AuthState {
  token: string | null;
  refreshToken: string | null;
  serverUrl: string | null;
  isLoading: boolean;
  login: (serverUrl: string, pin: string) => Promise<void>;
  logout: () => void;
  setToken: (token: string) => void;
  setLoading: (isLoading: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      refreshToken: null,
      serverUrl: null,
      isLoading: true,

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

      logout: () =>
        set({
          token: null,
          refreshToken: null,
          serverUrl: null,
        }),

      setToken: (token: string) => set({ token }),

      setLoading: (isLoading: boolean) => set({ isLoading }),
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        state?.setLoading(false);
      },
    },
  ),
);
