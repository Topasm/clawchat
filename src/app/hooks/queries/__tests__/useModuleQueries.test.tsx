import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectResponse, TodoResponse } from '../../../types/api';
import {
  useBulkUpdateTodos,
  useCreateTodo,
  useDeleteTodo,
  usePlaceTodo,
  usePlaceTodoGroups,
  usePlaceTodosBatch,
  usePreviewInboxTriage,
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

  it('optimistically inserts a task before its target under the hidden project root', async () => {
    const project: ProjectResponse = {
      id: 'project-1',
      title: 'Paper',
      status: 'active',
      root_task_id: 'root-1',
      graph_revision: 4,
      execution_workspace_isolation: 'local',
      created_at: todo.created_at,
      updated_at: todo.updated_at,
      task_count: 3,
      completed_task_count: 0,
    };
    const projectTasks: TodoResponse[] = ['First', 'Second', 'Third'].map((title, index) => ({
      ...todo,
      id: `task-${index + 1}`,
      title,
      project_id: project.id,
      parent_id: project.root_task_id,
      sort_order: index * 10,
      inbox_state: 'none',
    }));
    const { queryClient, wrapper } = createHarness();
    queryClient.setQueryData(queryKeys.projects, [project]);
    queryClient.setQueryData(queryKeys.todos, projectTasks);
    apiMocks.post.mockResolvedValueOnce({
      data: {
        todo: { ...projectTasks[2], sort_order: 10 },
        graph_revision: 6,
        affected_task_ids: ['task-2', 'task-3'],
        insights_delta: null,
        change_set_id: 'placement-1',
        reverted: false,
      },
    });
    const { result } = renderHook(() => usePlaceTodo(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        id: 'task-3',
        placement: {
          project_id: project.id,
          parent_id: null,
          before_id: 'task-2',
          inbox_state: 'none',
          expected_graph_revision: 4,
        },
      });
    });

    const reordered = queryClient
      .getQueryData<TodoResponse[]>(queryKeys.todos)
      ?.sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0));
    expect(reordered?.map((task) => task.id)).toEqual(['task-1', 'task-3', 'task-2']);
    expect(reordered?.[1].parent_id).toBe(project.root_task_id);
  });

  it('posts one batch placement and invalidates every task placement consumer', async () => {
    apiMocks.post.mockResolvedValueOnce({
      data: {
        todos: [
          { ...todo, id: 'task-1', project_id: 'project-1', inbox_state: 'none' },
          { ...todo, id: 'task-2', project_id: 'project-1', inbox_state: 'none' },
        ],
        graph_revision: 8,
        affected_task_ids: ['task-1', 'task-2'],
        insights_delta: null,
        change_set_id: 'placement-batch-1',
      },
    });
    const { queryClient, wrapper } = createHarness();
    const { result } = renderHook(() => usePlaceTodosBatch(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        todo_ids: ['task-1', 'task-2'],
        project_id: 'project-1',
        parent_id: null,
        before_id: null,
        inbox_state: 'none',
        expected_graph_revision: 6,
      });
    });

    expect(apiMocks.post).toHaveBeenCalledWith('/todos/placements/batch', {
      todo_ids: ['task-1', 'task-2'],
      project_id: 'project-1',
      parent_id: null,
      before_id: null,
      inbox_state: 'none',
      expected_graph_revision: 6,
    });
    expect(queryClient.getQueryState(queryKeys.todos)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.projects)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.taskGraphInsightScope(null))?.isInvalidated).toBe(
      true,
    );
  });

  it('previews Inbox triage without invalidating task data', async () => {
    apiMocks.post.mockResolvedValueOnce({
      data: {
        base_graph_revision: 6,
        suggestions: [
          {
            task_id: 'task-1',
            project_id: 'project-1',
            parent_id: null,
            confidence: 0.9,
            reason: 'Matches the project goal',
          },
        ],
        unassigned_task_ids: [],
        model_provider: 'test',
      },
    });
    const { queryClient, wrapper } = createHarness();
    const { result } = renderHook(() => usePreviewInboxTriage(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        todo_ids: ['task-1'],
        expected_graph_revision: 6,
      });
    });

    expect(apiMocks.post).toHaveBeenCalledWith('/todos/placements/triage-preview', {
      todo_ids: ['task-1'],
      expected_graph_revision: 6,
    });
    expect(queryClient.getQueryState(queryKeys.todos)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(queryKeys.projects)?.isInvalidated).toBe(false);
  });

  it('applies grouped placements and invalidates every placement consumer', async () => {
    apiMocks.post.mockResolvedValueOnce({
      data: {
        todos: [
          { ...todo, id: 'task-1', project_id: 'project-1', inbox_state: 'none' },
          { ...todo, id: 'task-2', project_id: 'project-2', inbox_state: 'none' },
        ],
        graph_revision: 9,
        affected_task_ids: ['task-1', 'task-2'],
        insights_delta: null,
        change_set_id: 'placement-groups-1',
      },
    });
    const { queryClient, wrapper } = createHarness();
    const { result } = renderHook(() => usePlaceTodoGroups(), { wrapper });
    const request = {
      groups: [
        {
          todo_ids: ['task-1'],
          project_id: 'project-1',
          parent_id: null,
          inbox_state: 'none' as const,
        },
        {
          todo_ids: ['task-2'],
          project_id: 'project-2',
          parent_id: 'parent-2',
          inbox_state: 'none' as const,
        },
      ],
      expected_graph_revision: 6,
    };

    await act(async () => {
      await result.current.mutateAsync(request);
    });

    expect(apiMocks.post).toHaveBeenCalledWith('/todos/placements/groups', request);
    expect(queryClient.getQueryState(queryKeys.todos)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.projects)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.taskGraphInsightScope(null))?.isInvalidated).toBe(
      true,
    );
  });
});
