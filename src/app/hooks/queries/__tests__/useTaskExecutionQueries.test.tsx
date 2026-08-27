import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '../../../stores/useAuthStore';
import { queryKeys } from '../queryKeys';
import { useSkillsQuery, useStartReadyTaskExecution } from '../useTaskExecutionQueries';

const apiMocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('../../../services/apiClient', () => ({ default: apiMocks }));

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(queryKeys.todos, []);
  queryClient.setQueryData(queryKeys.runs, []);
  queryClient.setQueryData(queryKeys.taskExecutionTelemetry, []);
  queryClient.setQueryData(queryKeys.projects, []);
  queryClient.setQueryData(queryKeys.taskGraphInsights, {});
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('Ready task execution queries', () => {
  beforeEach(() => {
    apiMocks.get.mockReset();
    apiMocks.post.mockReset();
    useAuthStore.setState({ serverUrl: 'https://host.example' });
  });

  it('loads executable skills from the server registry', async () => {
    apiMocks.get.mockResolvedValue({
      data: { skills: [{ id: 'research', name: 'Research', description: 'Research', tags: [] }] },
    });
    const { wrapper } = createHarness();
    const { result } = renderHook(() => useSkillsQuery(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiMocks.get).toHaveBeenCalledWith('/todos/skills/list');
    expect(result.current.data?.skills[0].id).toBe('research');
  });

  it('defers Skill discovery until an execution target is selected', () => {
    const { wrapper } = createHarness();
    const { result } = renderHook(() => useSkillsQuery(false), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(apiMocks.get).not.toHaveBeenCalled();
  });

  it('sends an explicit Ready-only approval and invalidates execution state', async () => {
    apiMocks.post.mockResolvedValue({
      data: {
        status: 'delegated',
        task_id: 'agent-task-1',
        todo_id: 'todo-1',
        agent_task_id: 'agent-task-1',
        run_id: 'run-1',
        skill_id: 'research',
        skill_chain: ['research'],
        agent_type: 'research',
      },
    });
    const { queryClient, wrapper } = createHarness();
    const { result } = renderHook(() => useStartReadyTaskExecution(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        todoId: 'todo-1',
        skillId: 'research',
        executionProvider: 'builtin',
      });
    });

    expect(apiMocks.post).toHaveBeenCalledWith('/todos/todo-1/delegate', {
      skill_id: 'research',
      execution_provider: 'builtin',
      model: null,
      require_ready: true,
      approved: true,
    });
    for (const key of [
      queryKeys.todos,
      queryKeys.runs,
      queryKeys.taskExecutionTelemetry,
      queryKeys.projects,
      queryKeys.taskGraphInsights,
    ]) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });
});
