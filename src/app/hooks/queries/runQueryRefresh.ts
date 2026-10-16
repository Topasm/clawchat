import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';

export const RUN_REFRESH_DELAY_MS = 500;

/** `['runs', projectId]` and `['runs', 'status', status]`, but not one run's event log. */
function isRunListKey(key: QueryKey): boolean {
  return key[0] === queryKeys.runs[0] && key[2] !== 'events';
}

export interface RunQueryRefresher {
  /** A run changed state: refresh the run lists, what they feed, and its event log. */
  runChanged: (runId?: string | null) => void;
  /** A run reported progress: only its event log can have moved. */
  runProgressed: (runId?: string | null) => void;
  dispose: () => void;
}

/**
 * Run events arrive in bursts (`run_state_changed`, `task_completed` and
 * `module_data_changed` for the same transition), and progress can tick many
 * times a second while active run queries already poll. Collect them and
 * refetch each affected query once per `delayMs`.
 */
export function createRunQueryRefresher(
  queryClient: QueryClient,
  delayMs = RUN_REFRESH_DELAY_MS,
): RunQueryRefresher {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let listsChanged = false;
  const runIds = new Set<string>();

  const flush = () => {
    timer = null;
    if (listsChanged) {
      listsChanged = false;
      void queryClient.invalidateQueries({ predicate: (query) => isRunListKey(query.queryKey) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.reviews });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskExecutionTelemetry });
    }
    for (const runId of runIds) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.runEvents(runId), exact: true });
    }
    runIds.clear();
  };

  const schedule = () => {
    timer ??= setTimeout(flush, delayMs);
  };

  return {
    runChanged: (runId) => {
      listsChanged = true;
      if (runId) runIds.add(runId);
      schedule();
    },
    runProgressed: (runId) => {
      if (!runId) return;
      runIds.add(runId);
      schedule();
    },
    dispose: () => {
      if (timer) clearTimeout(timer);
      timer = null;
      listsChanged = false;
      runIds.clear();
    },
  };
}
