import { create } from 'zustand';

export interface FailedRunNotice {
  runId: string;
  title: string;
  failedAt: number;
}

interface RunNoticeState {
  /** Runs that failed since the app was opened and have not been looked at. */
  failed: FailedRunNotice[];
  noteFailed: (runId: string, title: string) => void;
  /** Opening a failed run once is enough: the line stops mentioning it. */
  dismissFailed: (runId: string) => void;
}

/**
 * What the "running now" line knows beyond the live run queries: a failure
 * stays on the line until it has been opened once, so it is not missed while
 * the record of it lives on in the task.
 */
export const useRunNoticeStore = create<RunNoticeState>()((set) => ({
  failed: [],
  noteFailed: (runId, title) =>
    set((state) =>
      state.failed.some((item) => item.runId === runId)
        ? state
        : { failed: [...state.failed, { runId, title, failedAt: Date.now() }] },
    ),
  dismissFailed: (runId) =>
    set((state) => ({ failed: state.failed.filter((item) => item.runId !== runId) })),
}));
