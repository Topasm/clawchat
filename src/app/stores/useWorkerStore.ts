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
  /** What that run is about, as the sidebar should say it. */
  busyRunTitle: string | null;
  /**
   * Re-read a bound folder here and send its snapshot up. Only set while the
   * runner is up, and only meaningful for projects bound to this machine.
   */
  refreshProjectContext: ((projectId: string, path: string) => Promise<void>) | null;
  setRegistered: (hostId: string, label: string) => void;
  setBusy: (runId: string | null, title?: string | null) => void;
  setRefreshProjectContext: (fn: WorkerState['refreshProjectContext']) => void;
  reset: () => void;
}

const EMPTY = {
  hostId: null,
  label: null,
  busyRunId: null,
  busyRunTitle: null,
  refreshProjectContext: null,
};

export const useWorkerStore = create<WorkerState>()((set) => ({
  ...EMPTY,
  setRegistered: (hostId, label) => set({ hostId, label }),
  setBusy: (busyRunId, title = null) =>
    set({ busyRunId, busyRunTitle: busyRunId ? (title ?? null) : null }),
  setRefreshProjectContext: (refreshProjectContext) => set({ refreshProjectContext }),
  reset: () => set(EMPTY),
}));
