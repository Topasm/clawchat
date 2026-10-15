import { create } from 'zustand';

/**
 * What the active workspace's `/api/health` last said to this signed-in app.
 * The shell polls it; banners and settings read it instead of asking again.
 */
export interface ServerHealthSnapshot {
  version: string;
  status: 'ok' | 'degraded';
  aiConnected: boolean;
  aiProvider: string | null;
  aiModel: string;
}

interface ServerHealthState {
  /** The server the snapshot came from, so a stale answer never describes a new workspace. */
  serverUrl: string | null;
  health: ServerHealthSnapshot | null;
  setHealth: (serverUrl: string, health: ServerHealthSnapshot) => void;
  clear: () => void;
}

export function parseServerHealth(data: unknown): ServerHealthSnapshot | null {
  if (!data || typeof data !== 'object') return null;
  const raw = data as Record<string, unknown>;
  if (typeof raw.ai_connected !== 'boolean') return null;
  return {
    version: typeof raw.version === 'string' ? raw.version : '',
    status: raw.status === 'ok' ? 'ok' : 'degraded',
    aiConnected: raw.ai_connected,
    aiProvider:
      typeof raw.ai_provider === 'string'
        ? raw.ai_provider
        : typeof raw.ai_backend === 'string'
          ? raw.ai_backend
          : null,
    aiModel: typeof raw.ai_model === 'string' ? raw.ai_model : '',
  };
}

export const useServerHealthStore = create<ServerHealthState>((set) => ({
  serverUrl: null,
  health: null,
  setHealth: (serverUrl, health) => set({ serverUrl, health }),
  clear: () => set({ serverUrl: null, health: null }),
}));
