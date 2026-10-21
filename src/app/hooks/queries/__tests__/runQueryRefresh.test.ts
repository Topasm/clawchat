import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { queryKeys } from '../queryKeys';
import { createRunQueryRefresher, RUN_REFRESH_DELAY_MS } from '../runQueryRefresh';

function seededClient() {
  const queryClient = new QueryClient();
  for (const key of [
    queryKeys.runList('all'),
    queryKeys.runList('project-1'),
    queryKeys.runsByStatus('waiting_input'),
    queryKeys.runEvents('run-1'),
    [...queryKeys.runEvents('run-1'), 'tail', 20],
    queryKeys.runEvents('run-2'),
    queryKeys.reviews,
    queryKeys.projects,
    [...queryKeys.taskExecutionTelemetry, 'all'],
    queryKeys.todos,
  ]) {
    queryClient.setQueryData(key, []);
  }
  return queryClient;
}

function invalidated(queryClient: QueryClient) {
  return queryClient
    .getQueryCache()
    .getAll()
    .filter((query) => query.state.isInvalidated)
    .map((query) => JSON.stringify(query.queryKey))
    .sort();
}

describe('createRunQueryRefresher', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('refreshes only the progressing run event log', () => {
    const queryClient = seededClient();
    const refresher = createRunQueryRefresher(queryClient);

    for (let i = 0; i < 20; i += 1) refresher.runProgressed('run-1');
    expect(invalidated(queryClient)).toEqual([]);
    vi.advanceTimersByTime(RUN_REFRESH_DELAY_MS);

    expect(invalidated(queryClient)).toEqual(
      [
        JSON.stringify(queryKeys.runEvents('run-1')),
        JSON.stringify([...queryKeys.runEvents('run-1'), 'tail', 20]),
      ].sort(),
    );
  });

  it('coalesces a burst of state changes into one refresh of the run lists', () => {
    const queryClient = seededClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const refresher = createRunQueryRefresher(queryClient);

    refresher.runChanged('run-1');
    refresher.runChanged('run-1');
    refresher.runProgressed('run-1');
    vi.advanceTimersByTime(RUN_REFRESH_DELAY_MS);

    // Run lists, reviews, projects, telemetry, and the one event log (with its tail).
    expect(invalidate).toHaveBeenCalledTimes(5);
    expect(invalidated(queryClient)).toEqual(
      [
        queryKeys.runList('all'),
        queryKeys.runList('project-1'),
        queryKeys.runsByStatus('waiting_input'),
        queryKeys.runEvents('run-1'),
        [...queryKeys.runEvents('run-1'), 'tail', 20],
        queryKeys.reviews,
        queryKeys.projects,
        [...queryKeys.taskExecutionTelemetry, 'all'],
      ]
        .map((key) => JSON.stringify(key))
        .sort(),
    );
  });

  it('drops pending work when disposed', () => {
    const queryClient = seededClient();
    const refresher = createRunQueryRefresher(queryClient);

    refresher.runChanged('run-1');
    refresher.dispose();
    vi.advanceTimersByTime(RUN_REFRESH_DELAY_MS);

    expect(invalidated(queryClient)).toEqual([]);
  });
});
