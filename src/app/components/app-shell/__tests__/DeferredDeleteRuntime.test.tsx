import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../../../hooks/queries/queryKeys';
import { deferredDeleteQueue } from '../../../services/deferredDeleteQueue';
import { getOfflineQueueScope } from '../../../services/offlineQueue';
import { useAuthStore } from '../../../stores/useAuthStore';
import DeferredDeleteRuntime from '../DeferredDeleteRuntime';

const apiMocks = vi.hoisted(() => ({ delete: vi.fn() }));

vi.mock('../../../services/apiClient', () => ({
  default: { delete: apiMocks.delete },
}));

function createToken(subject: string): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${encode({ alg: 'none' })}.${encode({ sub: subject })}.signature`;
}

describe('DeferredDeleteRuntime', () => {
  beforeEach(() => {
    localStorage.clear();
    apiMocks.delete.mockReset();
    apiMocks.delete.mockResolvedValue({ data: undefined });
    useAuthStore.setState({
      serverUrl: 'https://host.example',
      token: createToken('user-1'),
    });
  });

  it('executes an overdue persisted task delete and invalidates consumers', async () => {
    const scope = getOfflineQueueScope(useAuthStore.getState());
    deferredDeleteQueue.enqueue(scope, 'todo', 'task-1', 0);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(queryKeys.todos, []);
    queryClient.setQueryData(queryKeys.taskRelationships, []);
    queryClient.setQueryData(queryKeys.taskGraphInsightScope(null), { graph_revision: 1 });
    queryClient.setQueryData(queryKeys.projects, []);

    render(
      <QueryClientProvider client={queryClient}>
        <DeferredDeleteRuntime />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(apiMocks.delete).toHaveBeenCalledWith('/todos/task-1', {
        queueOfflineMutation: true,
      });
    });
    await waitFor(() => expect(deferredDeleteQueue.getItems(scope)).toEqual([]));
    expect(queryClient.getQueryState(queryKeys.taskRelationships)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.taskGraphInsightScope(null))?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(queryKeys.projects)?.isInvalidated).toBe(true);
  });
});
