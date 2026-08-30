import { create } from 'zustand';
import { platformApi } from '../platform';
import type {
  AppMode,
  LocalServerTransitionResult,
  ServerConfig,
  ServerConfigUpdate,
  ServerStatus,
} from '../platform';
import { logger } from '../services/logger';

export type WorkspaceBootstrapPhase =
  | 'reading_config'
  | 'starting_local_server'
  | 'connecting'
  | 'ready'
  | 'action_required';

export interface WorkspaceTransition {
  kind: 'local_server_policy' | 'workspace';
  phase: 'preflight' | 'activating' | 'rolling_back';
  from: string | null;
  to: string;
}

interface WorkspaceRuntimeState {
  bootstrapPhase: WorkspaceBootstrapPhase;
  config: ServerConfig | null;
  localServerStatus: ServerStatus | null;
  transition: WorkspaceTransition | null;
  error: string | null;
  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  updateLocalServerPolicy: (updates: ServerConfigUpdate) => Promise<LocalServerTransitionResult>;
  setCompatibilityMode: (mode: AppMode) => Promise<LocalServerTransitionResult>;
  setWorkspaceTransition: (transition: WorkspaceTransition | null) => void;
  reset: () => void;
}

let initializePromise: Promise<void> | null = null;
let stopStatusSubscription: (() => void) | null = null;
let stopRuntimeSubscription: (() => void) | null = null;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function phaseFor(config: ServerConfig, status: ServerStatus): WorkspaceBootstrapPhase {
  if (!config.localServerEnabled) return 'ready';
  if (status.state === 'running') return 'ready';
  if (status.state === 'starting') return 'starting_local_server';
  return 'action_required';
}

function requireApplied(result: LocalServerTransitionResult): LocalServerTransitionResult {
  if (!result.applied) {
    throw new Error(
      result.status.error ||
        (result.config.localServerEnabled
          ? 'The local server setting was saved, but the workspace did not become ready.'
          : 'The local server setting was saved, but the server did not stop.'),
    );
  }
  return result;
}

export const useWorkspaceRuntimeStore = create<WorkspaceRuntimeState>((set, get) => ({
  bootstrapPhase: platformApi.runtime.isDesktop ? 'reading_config' : 'ready',
  config: null,
  localServerStatus: null,
  transition: null,
  error: null,

  initialize: async () => {
    if (!platformApi.runtime.isDesktop) {
      set({ bootstrapPhase: 'ready', error: null });
      return;
    }
    if (initializePromise) return initializePromise;
    initializePromise = (async () => {
      set({ bootstrapPhase: 'reading_config', error: null });
      stopStatusSubscription ??= platformApi.server.onStatusChange((status) => {
        const config = get().config;
        set({
          localServerStatus: status,
          bootstrapPhase: config ? phaseFor(config, status) : get().bootstrapPhase,
          error: status.state === 'error' ? (status.error ?? 'Local server error') : null,
        });
      });
      stopRuntimeSubscription ??= platformApi.server.onRuntimeChange((runtime) => {
        set({
          config: runtime.config,
          localServerStatus: runtime.status,
          bootstrapPhase: phaseFor(runtime.config, runtime.status),
          error: runtime.applied ? null : (runtime.status.error ?? 'Local server transition failed'),
        });
      });
      await get().refresh();
    })().finally(() => {
      initializePromise = null;
    });
    return initializePromise;
  },

  refresh: async () => {
    if (!platformApi.runtime.isDesktop) return;
    try {
      const [config, status] = await Promise.all([
        platformApi.server.getConfig(),
        platformApi.server.getStatus(),
      ]);
      set({
        config,
        localServerStatus: status,
        bootstrapPhase: phaseFor(config, status),
        error: status.state === 'error' ? (status.error ?? 'Local server error') : null,
      });
    } catch (error) {
      const message = messageOf(error);
      logger.error('Could not initialize the workspace runtime', error);
      set({ bootstrapPhase: 'action_required', error: message });
    }
  },

  updateLocalServerPolicy: async (updates) => {
    set({
      transition: {
        kind: 'local_server_policy',
        phase: 'activating',
        from: null,
        to: updates.localServerEnabled === false ? 'disabled' : 'enabled',
      },
      error: null,
    });
    try {
      const result = requireApplied(await platformApi.server.updateConfig(updates));
      set({
        config: result.config,
        localServerStatus: result.status,
        bootstrapPhase: phaseFor(result.config, result.status),
      });
      return result;
    } catch (error) {
      const message = messageOf(error);
      set({ bootstrapPhase: 'action_required', error: message });
      throw error;
    } finally {
      set({ transition: null });
    }
  },

  setCompatibilityMode: async (mode) => {
    const result = requireApplied(await platformApi.server.setAppMode(mode));
    set({
      config: result.config,
      localServerStatus: result.status,
      bootstrapPhase: phaseFor(result.config, result.status),
      error: null,
    });
    return result;
  },

  setWorkspaceTransition: (transition) => set({ transition }),

  reset: () => {
    stopStatusSubscription?.();
    stopRuntimeSubscription?.();
    stopStatusSubscription = null;
    stopRuntimeSubscription = null;
    initializePromise = null;
    set({
      bootstrapPhase: platformApi.runtime.isDesktop ? 'reading_config' : 'ready',
      config: null,
      localServerStatus: null,
      transition: null,
      error: null,
    });
  },
}));
