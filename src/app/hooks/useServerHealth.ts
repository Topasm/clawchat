import { useEffect } from 'react';
import apiClient from '../services/apiClient';
import { useAuthStore } from '../stores/useAuthStore';
import {
  parseServerHealth,
  useServerHealthStore,
  type ServerHealthSnapshot,
} from '../stores/useServerHealthStore';

const HEALTH_POLL_INTERVAL_MS = 60_000;

/** Ask the workspace server how it is; resolves false when it did not answer. */
export async function refreshServerHealth(serverUrl: string): Promise<boolean> {
  const store = useServerHealthStore.getState();
  try {
    const response = await apiClient.get(`${serverUrl}/api/health`);
    if (useAuthStore.getState().serverUrl !== serverUrl) return true;
    const health = parseServerHealth(response.data);
    if (health) store.setHealth(serverUrl, health);
    else store.clear();
    return true;
  } catch {
    if (useAuthStore.getState().serverUrl === serverUrl) store.clear();
    return false;
  }
}

/** The shell's poll: keeps the snapshot and `healthOK` current while it is mounted. */
export function useServerHealthPolling(): void {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const setHealthOK = useAuthStore((state) => state.setHealthOK);
  useEffect(() => {
    if (useServerHealthStore.getState().serverUrl !== serverUrl) {
      useServerHealthStore.getState().clear();
    }
    if (!serverUrl) {
      setHealthOK(true);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      const reachable = await refreshServerHealth(serverUrl);
      if (!cancelled) setHealthOK(reachable);
    };
    void poll();
    const interval = setInterval(() => void poll(), HEALTH_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [serverUrl, setHealthOK]);
}

/**
 * The active workspace's last health snapshot. Screens outside the shell
 * (settings) ask once when nothing is known yet.
 */
export function useServerHealth(): ServerHealthSnapshot | null {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const health = useServerHealthStore((state) =>
    state.serverUrl === serverUrl ? state.health : null,
  );
  const known = health !== null;
  useEffect(() => {
    if (!serverUrl || known) return;
    void refreshServerHealth(serverUrl);
  }, [known, serverUrl]);
  return health;
}
