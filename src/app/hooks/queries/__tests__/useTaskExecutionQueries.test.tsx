import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '../../../stores/useAuthStore';
import { queryKeys } from '../queryKeys';
import {
  useRunReadyTaskWithProjectDefaults,
  useSkillsQuery,
  useStartReadyTaskExecution,
} from '../useTaskExecutionQueries';

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

  it('uses the task Skill and Project defaults only after Run next is requested', async () => {
    apiMocks.get.mockImplementation((url: string) => {
      if (url === '/todos') {
        return Promise.resolve({
          data: {
            items: [
              {
                id: 'todo-next',
                title: 'Publish report',
                project_id: 'project-1',
                status: 'pending',
                enabled_skills: ['publish'],
                created_at: '2026-09-04T00:00:00Z',
                updated_at: '2026-09-04T00:00:00Z',
              },
            ],
          },
        });
      }
      if (url === '/projects') {
        return Promise.resolve({
          data: [
            {
              id: 'project-1',
              title: 'Research',
              status: 'active',
              root_task_id: 'root-1',
              graph_revision: 8,
              default_execution_provider: 'paseo',
              default_execution_model: 'codex/gpt-5.6',
              execution_workspace_isolation: 'local',
              created_at: '2026-09-04T00:00:00Z',
              updated_at: '2026-09-04T00:00:00Z',
              task_count: 2,
              completed_task_count: 1,
            },
          ],
        });
      }
      if (url === '/todos/skills/list') {
        return Promise.resolve({
          data: {
            skills: [
              { id: 'plan', name: 'Plan', description: 'Plan work' },
              { id: 'publish', name: 'Publish', description: 'Publish work' },
            ],
          },
        });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    apiMocks.post.mockResolvedValue({
      data: {
        status: 'delegated',
        task_id: 'agent-task-next',
        todo_id: 'todo-next',
        agent_task_id: 'agent-task-next',
        run_id: 'run-next',
        skill_id: 'publish',
        skill_chain: ['publish'],
        agent_type: 'publish',
      },
    });
    const { wrapper } = createHarness();
    const { result } = renderHook(() => useRunReadyTaskWithProjectDefaults(true), { wrapper });

    await waitFor(() => expect(result.current.canRunTask('todo-next')).toBe(true));
    expect(apiMocks.post).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.runTask('todo-next', 'project-1');
    });

    expect(apiMocks.post).toHaveBeenCalledWith('/todos/todo-next/delegate', {
      skill_id: 'publish',
      execution_provider: 'paseo',
      model: 'codex/gpt-5.6',
      require_ready: true,
      approved: true,
    });
  });
});
