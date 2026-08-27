import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TodoResponse } from '../../../types/api';
import {
  useBulkUpdateTodos,
  useCreateTodo,
  useDeleteTodo,
  useReorderTodos,
  useSetTaskStatus,
  useToggleTodoComplete,
  useUpdateTodo,
} from '../useModuleQueries';
import { queryKeys } from '../queryKeys';

const apiMocks = vi.hoisted(() => ({
  patch: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('../../../services/apiClient', () => ({
  default: {
    patch: apiMocks.patch,
    post: apiMocks.post,
    delete: apiMocks.delete,
  },
}));

const todo: TodoResponse = {
  id: 'task-1',
  title: 'Canonical status',
  status: 'pending',
  created_at: '2026-08-27T00:00:00Z',
  updated_at: '2026-08-27T00:00:00Z',
};

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  queryClient.setQueryData<TodoResponse[]>(queryKeys.todos, [todo]);
  queryClient.setQueryData(queryKeys.today, { today_tasks: [] });
  queryClient.setQueryData(queryKeys.taskRelationships, []);
  queryClient.setQueryData(queryKeys.taskGraphInsightScope(null), { graph_revision: 1 });
  queryClient.setQueryData(queryKeys.projects, []);

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return { queryClient, wrapper };
}

describe('todo mutations', () => {
  beforeEach(() => {
    apiMocks.patch.mockReset();
    apiMocks.patch.mockResolvedValue({ data: undefined });
    apiMocks.post.mockReset();
    apiMocks.delete.mockReset();
  });

  it('invalidates relationships after a bulk operation that may delete tasks', async () => {
    const { queryClient, wrapper } = createHarness();
    const { result } = renderHook(() => useBulkUpdateTodos(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ ids: ['task-1'], delete: true });
    });

    expect(apiMocks.patch).toHaveBeenCalledWith('/todos/bulk', {
      ids: ['task-1'],
      delete: true,
    });
    expect(queryClient.getQueryState(queryKeys.taskRelationships)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.taskGraphInsightScope(null))?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(queryKeys.projects)?.isInvalidated).toBe(true);
  });

  it('invalidates relationships after the deferred task delete reaches the server', async () => {
    vi.useFakeTimers();
    apiMocks.delete.mockResolvedValueOnce({ data: undefined });
    try {
      const { queryClient, wrapper } = createHarness();
      const { result } = renderHook(() => useDeleteTodo(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('task-1');
      });
      expect(queryClient.getQueryState(queryKeys.taskRelationships)?.isInvalidated).toBe(false);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(apiMocks.delete).toHaveBeenCalledWith('/todos/task-1');
      expect(queryClient.getQueryState(queryKeys.taskRelationships)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(queryKeys.taskGraphInsightScope(null))?.isInvalidated).toBe(
        true,
      );
      expect(queryClient.getQueryState(queryKeys.projects)?.isInvalidated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('persists in_progress without mapping it back to pending', async () => {
    const { queryClient, wrapper } = createHarness();
    const { result } = renderHook(() => useSetTaskStatus(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: todo.id, status: 'in_progress' });
    });

    expect(apiMocks.patch).toHaveBeenCalledWith('/todos/task-1', { status: 'in_progress' });
    expect(queryClient.getQueryData<TodoResponse[]>(queryKeys.todos)?.[0].status).toBe(
      'in_progress',
    );
    expect(queryClient.getQueryState(queryKeys.today)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.taskGraphInsightScope(null))?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(queryKeys.projects)?.isInvalidated).toBe(true);
  });

  it('rolls the canonical query state back when persistence fails', async () => {
    apiMocks.patch.mockRejectedValueOnce(new Error('network unavailable'));
    const { queryClient, wrapper } = createHarness();
    const { result } = renderHook(() => useSetTaskStatus(), { wrapper });

    await expect(
      act(async () => {
        await result.current.mutateAsync({ id: todo.id, status: 'cancelled' });
      }),
    ).rejects.toThrow('network unavailable');

    await waitFor(() => {
      expect(queryClient.getQueryData<TodoResponse[]>(queryKeys.todos)?.[0].status).toBe('pending');
    });
  });

  it('invalidates derived graph data after creating a task', async () => {
    apiMocks.post.mockResolvedValueOnce({ data: { ...todo, id: 'created-task' } });
    const { queryClient, wrapper } = createHarness();
    const { result } = renderHook(() => useCreateTodo(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ title: 'Created task' });
    });

    expect(queryClient.getQueryState(queryKeys.taskGraphInsightScope(null))?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(queryKeys.projects)?.isInvalidated).toBe(true);
  });

  it('invalidates derived graph data after updating a task', async () => {
    const { queryClient, wrapper } = createHarness();
    const { result } = renderHook(() => useUpdateTodo(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: todo.id, data: { title: 'Updated task' } });
    });

    expect(queryClient.getQueryState(queryKeys.taskGraphInsightScope(null))?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(queryKeys.projects)?.isInvalidated).toBe(true);
  });

  it('invalidates derived graph data after toggling completion', async () => {
    const { queryClient, wrapper } = createHarness();
    const { result } = renderHook(() => useToggleTodoComplete(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: todo.id, currentStatus: todo.status });
    });

    expect(queryClient.getQueryState(queryKeys.taskGraphInsightScope(null))?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(queryKeys.projects)?.isInvalidated).toBe(true);
  });

  it('invalidates derived graph data after reordering tasks', async () => {
    const { queryClient, wrapper } = createHarness();
    const { result } = renderHook(() => useReorderTodos(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ updates: { [todo.id]: 10 } });
    });

    expect(queryClient.getQueryState(queryKeys.taskGraphInsightScope(null))?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(queryKeys.projects)?.isInvalidated).toBe(true);
  });
});
