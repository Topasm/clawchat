import { create } from 'zustand';
import type { ConnectionStatus, ClaudeCodeInfo, HostHealth } from '../types/connection';
import apiClient from '../services/apiClient';

interface ConnectionState {
  // State
  status: ConnectionStatus;
  hostHealth: HostHealth | null;
  claudeCode: ClaudeCodeInfo;
  lastHealthCheck: number | null;
  isPolling: boolean;

  // Actions
  checkHealth: () => Promise<void>;
  startPolling: (intervalMs?: number) => void;
  stopPolling: () => void;
  setStatus: (status: ConnectionStatus) => void;
}

let pollInterval: ReturnType<typeof setInterval> | null = null;

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  status: 'offline',
  hostHealth: null,
  claudeCode: { status: 'unknown', version: null },
  lastHealthCheck: null,
  isPolling: false,

  checkHealth: async () => {
    try {
      const response = await apiClient.get('/health', { timeout: 5000 });
      const data = response.data;

      const health: HostHealth = {
        status: data.status,
        version: data.version,
        aiProvider: data.ai_provider,
        aiModel: data.ai_model,
        aiConnected: data.ai_connected,
        claudeCodeStatus: data.claude_code_status || 'unknown',
        claudeCodeVersion: data.claude_code_version || null,
      };

      const claudeCode: ClaudeCodeInfo = {
        status: health.claudeCodeStatus,
        version: health.claudeCodeVersion,
      };

      const status: ConnectionStatus = health.claudeCodeStatus === 'available'
        ? 'host_online'
        : health.status === 'ok' || health.status === 'degraded'
          ? 'claude_unavailable'
          : 'host_unreachable';

      set({
        status,
        hostHealth: health,
        claudeCode,
        lastHealthCheck: Date.now(),
      });
    } catch {
      set({
        status: 'host_unreachable',
        hostHealth: null,
        lastHealthCheck: Date.now(),
      });
    }
  },

  startPolling: (intervalMs = 30000) => {
    const { stopPolling, checkHealth } = get();
    stopPolling();
    checkHealth(); // immediate check
    pollInterval = setInterval(checkHealth, intervalMs);
    set({ isPolling: true });
  },

  stopPolling: () => {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    set({ isPolling: false });
  },

  setStatus: (status) => set({ status }),
}));
