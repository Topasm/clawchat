import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../../stores/useAuthStore';
import type { TaskRelationshipResponse } from '../../../types/api';
import { queryKeys } from '../queryKeys';
import {
  useCreateTaskDependency,
  useCreateTaskRelationship,
  useDeleteTaskRelationship,
  usePreviewTaskDependency,
  useTaskRelationshipsQuery,
} from '../useTaskRelationshipQueries';

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('../../../services/apiClient', () => ({
  default: apiMocks,
}));

const relationship: TaskRelationshipResponse = {
  id: 'relationship-1',
  source_task_id: 'dependent-task',
  target_task_id: 'prerequisite-task',
  type: 'depends_on',
  label: null,
  created_by: 'user',
  proposal_id: null,
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
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('task relationship queries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ serverUrl: 'http://localhost:8000' });
  });

  it('loads and unwraps an items response', async () => {
    apiMocks.get.mockResolvedValueOnce({ data: { items: [relationship] } });
    const { wrapper } = createHarness();
    const { result } = renderHook(() => useTaskRelationshipsQuery(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiMocks.get).toHaveBeenCalledWith('/task-relationships', {
      params: { limit: 10_000 },
    });
    expect(result.current.data).toEqual([relationship]);
  });

  it('loads the API maximum of 10,000 relationships without truncation', async () => {
    const relationships = Array.from({ length: 10_000 }, (_, index) => ({
      ...relationship,
      id: `relationship-${index}`,
      target_task_id: `prerequisite-${index}`,
    }));
    apiMocks.get.mockResolvedValueOnce({ data: relationships });
    const { wrapper } = createHarness();
    const { result } = renderHook(() => useTaskRelationshipsQuery(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(10_000);
    expect(result.current.data?.at(-1)?.id).toBe('relationship-9999');
  });

  it('creates an edge using the normalized direction and invalidates the list', async () => {
    apiMocks.post.mockResolvedValueOnce({ data: relationship });
    const { queryClient, wrapper } = createHarness();
    queryClient.setQueryData(queryKeys.taskRelationships, []);
    const { result } = renderHook(() => useCreateTaskRelationship(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        source_task_id: 'dependent-task',
        target_task_id: 'prerequisite-task',
        type: 'depends_on',
      });
    });

    expect(apiMocks.post).toHaveBeenCalledWith('/task-relationships', {
      source_task_id: 'dependent-task',
      target_task_id: 'prerequisite-task',
      type: 'depends_on',
    });
    expect(queryClient.getQueryState(queryKeys.taskRelationships)?.isInvalidated).toBe(true);
  });

  it('previews a semantic dependency command without invalidating cached graph data', async () => {
    const preview = {
      dependent_task_id: 'dependent-task',
      prerequisite_task_id: 'prerequisite-task',
      base_graph_revision: 7,
      affected_task_ids: ['dependent-task'],
      insights_delta: {
        ready_count: -1,
        blocked_count: 1,
        critical_path_minutes: 20,
      },
    };
    apiMocks.post.mockResolvedValueOnce({ data: preview });
    const { queryClient, wrapper } = createHarness();
    queryClient.setQueryData(queryKeys.taskGraphInsights, { graph_revision: 7 });
    const { result } = renderHook(() => usePreviewTaskDependency(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        dependent_task_id: 'dependent-task',
        prerequisite_task_id: 'prerequisite-task',
        expected_graph_revision: 7,
      });
    });

    expect(apiMocks.post).toHaveBeenCalledWith('/task-relationships/commands/dependency/preview', {
      dependent_task_id: 'dependent-task',
      prerequisite_task_id: 'prerequisite-task',
      expected_graph_revision: 7,
    });
    expect(queryClient.getQueryState(queryKeys.taskGraphInsights)?.isInvalidated).toBe(false);
  });

  it('applies a dependency command and invalidates every graph consumer', async () => {
    apiMocks.post.mockResolvedValueOnce({
      data: {
        relationship,
        dependent_task_id: 'dependent-task',
        prerequisite_task_id: 'prerequisite-task',
        base_graph_revision: 7,
        graph_revision: 8,
        affected_task_ids: ['dependent-task'],
        insights_delta: {
          ready_count: -1,
          blocked_count: 1,
          critical_path_minutes: 20,
        },
      },
    });
    const { queryClient, wrapper } = createHarness();
    queryClient.setQueryData(queryKeys.taskRelationships, []);
    queryClient.setQueryData(queryKeys.taskGraphInsights, { graph_revision: 7 });
    queryClient.setQueryData(queryKeys.todos, []);
    queryClient.setQueryData(queryKeys.projects, []);
    const { result } = renderHook(() => useCreateTaskDependency(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        dependent_task_id: 'dependent-task',
        prerequisite_task_id: 'prerequisite-task',
        expected_graph_revision: 7,
      });
    });

    expect(apiMocks.post).toHaveBeenCalledWith('/task-relationships/commands/dependency', {
      dependent_task_id: 'dependent-task',
      prerequisite_task_id: 'prerequisite-task',
      expected_graph_revision: 7,
    });
    expect(queryClient.getQueryState(queryKeys.taskRelationships)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.taskGraphInsights)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.todos)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.projects)?.isInvalidated).toBe(true);
  });

  it('deletes by relationship ID and invalidates the list', async () => {
    apiMocks.delete.mockResolvedValueOnce({ data: undefined });
    const { queryClient, wrapper } = createHarness();
    queryClient.setQueryData(queryKeys.taskRelationships, [relationship]);
    const { result } = renderHook(() => useDeleteTaskRelationship(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(relationship.id);
    });

    expect(apiMocks.delete).toHaveBeenCalledWith('/task-relationships/relationship-1');
    expect(queryClient.getQueryState(queryKeys.taskRelationships)?.isInvalidated).toBe(true);
  });
});
