import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useToastStore } from '../../../stores/useToastStore';
import { queryKeys } from '../queryKeys';
import { useReturnAgentRunToReady } from '../useAgentRunQueries';

const apiMocks = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock('../../../services/apiClient', () => ({ default: apiMocks }));

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  for (const key of [
    queryKeys.runs,
    queryKeys.projects,
    queryKeys.reviews,
    queryKeys.taskExecutionTelemetry,
    queryKeys.todos,
    queryKeys.taskGraphInsights,
  ]) {
    queryClient.setQueryData(key, {});
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('Agent Run recovery queries', () => {
  beforeEach(() => {
    apiMocks.post.mockReset();
    useToastStore.setState({ toasts: [] });
  });

  it('returns an unsuccessful task to the canonical queue and refreshes graph state', async () => {
    apiMocks.post.mockResolvedValue({
      data: {
        run_id: 'run-1',
        todo_id: 'todo-1',
        todo_status: 'pending',
        graph_revision: 12,
        execution_state: 'ready',
        is_ready: true,
        direct_blocker_ids: [],
      },
    });
    const { queryClient, wrapper } = createHarness();
    const { result } = renderHook(() => useReturnAgentRunToReady(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync('run-1');
    });

    expect(apiMocks.post).toHaveBeenCalledWith('/runs/run-1/return-to-ready');
    for (const key of [queryKeys.runs, queryKeys.todos, queryKeys.taskGraphInsights]) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    }
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe('Task returned to Ready');
  });

  it('reports when a recovered task is blocked by changed dependencies', async () => {
    apiMocks.post.mockResolvedValue({
      data: {
        run_id: 'run-1',
        todo_id: 'todo-1',
        todo_status: 'pending',
        graph_revision: 13,
        execution_state: 'blocked',
        is_ready: false,
        direct_blocker_ids: ['todo-prerequisite'],
      },
    });
    const { wrapper } = createHarness();
    const { result } = renderHook(() => useReturnAgentRunToReady(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync('run-1');
    });

    expect(useToastStore.getState().toasts.at(-1)?.message).toBe(
      'Task returned to the queue · Blocked',
    );
  });
});
