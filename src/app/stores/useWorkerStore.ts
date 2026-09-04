import { create } from 'zustand';

/**
 * What this machine is doing as a worker, for the UI to show and to ask of.
 *
 * Not persisted: a worker exists only while its app runs, so this state is
 * exactly as long-lived as the runner that fills it in.
 */
interface WorkerState {
  /** The host id the server gave this machine, once registered. */
  hostId: string | null;
  label: string | null;
  /** The run this machine is executing right now, if any. */
  busyRunId: string | null;
  /**
   * Re-read a bound folder here and send its snapshot up. Only set while the
   * runner is up, and only meaningful for projects bound to this machine.
   */
  refreshProjectContext: ((projectId: string, path: string) => Promise<void>) | null;
  setRegistered: (hostId: string, label: string) => void;
  setBusyRunId: (runId: string | null) => void;
  setRefreshProjectContext: (fn: WorkerState['refreshProjectContext']) => void;
  reset: () => void;
}

const EMPTY = {
  hostId: null,
  label: null,
  busyRunId: null,
  refreshProjectContext: null,
};

export const useWorkerStore = create<WorkerState>()((set) => ({
  ...EMPTY,
  setRegistered: (hostId, label) => set({ hostId, label }),
  setBusyRunId: (busyRunId) => set({ busyRunId }),
  setRefreshProjectContext: (refreshProjectContext) => set({ refreshProjectContext }),
  reset: () => set(EMPTY),
}));
