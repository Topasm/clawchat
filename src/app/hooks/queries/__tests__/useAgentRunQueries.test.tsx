import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useToastStore } from '../../../stores/useToastStore';
import { useAuthStore } from '../../../stores/useAuthStore';
import { isHomeReachableNow } from '../../../services/homeReachability';
import { queryKeys } from '../queryKeys';
import {
  useResumeAgentRun,
  useRetryAgentRun,
  useReturnAgentRunToReady,
} from '../useAgentRunQueries';

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

describe('Agent Run hand-offs while Home is out of reach', () => {
  beforeEach(() => {
    apiMocks.post.mockReset();
    useToastStore.setState({ toasts: [] });
  });

  it('holds a retry and a resume back, and says to reconnect', async () => {
    vi.useFakeTimers();
    try {
      useAuthStore.setState({ serverUrl: 'http://home.local:8000', connectionStatus: 'connected' });
      // The offline banner asks as soon as the app mounts; that starts the clock.
      isHomeReachableNow();
      useAuthStore.setState({ connectionStatus: 'disconnected' });
      vi.advanceTimersByTime(4000);
      const { wrapper } = createHarness();
      const retry = renderHook(() => useRetryAgentRun(), { wrapper }).result;
      const resume = renderHook(() => useResumeAgentRun(), { wrapper }).result;

      await act(async () => {
        await expect(retry.current.mutateAsync({ runId: 'run-1' })).rejects.toThrow();
        await expect(
          resume.current.mutateAsync({ runId: 'run-1', followUp: 'go on' }),
        ).rejects.toThrow();
      });

      expect(apiMocks.post).not.toHaveBeenCalled();
      const messages = useToastStore.getState().toasts.map((toast) => toast.message);
      expect(messages).toHaveLength(2);
      expect(messages.every((message) => message.startsWith('Reconnect to '))).toBe(true);
    } finally {
      vi.useRealTimers();
      useAuthStore.setState({ serverUrl: null, connectionStatus: 'disconnected' });
    }
  });
});
