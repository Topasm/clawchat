import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../../stores/useAuthStore';
import type { TaskGraphInsightsResponse } from '../../../types/api';
import { useTaskGraphInsightsQuery } from '../useTaskGraphInsightsQuery';

const apiMocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('../../../services/apiClient', () => ({ default: apiMocks }));

const insights: TaskGraphInsightsResponse = {
  graph_revision: 12,
  generated_at: '2026-08-27T04:30:00Z',
  scope: {
    root_task_id: 'project-1',
    task_count: 1,
    primary_task_count: 1,
    relationship_count: 0,
    prerequisite_task_count: 0,
  },
  nodes: [
    {
      task_id: 'task-1',
      title: 'Ready task',
      status: 'pending',
      parent_id: 'project-1',
      scope_role: 'descendant',
      execution_state: 'ready',
      estimated_minutes: 30,
      due_date: null,
      dependency_ids: [],
      direct_blocker_ids: [],
      transitive_blocker_ids: [],
      transitive_blocker_count: 0,
      transitive_blockers_truncated: false,
      downstream_task_ids: [],
      downstream_count: 0,
      downstream_truncated: false,
      is_container: false,
      is_ready: true,
      is_blocked: false,
      is_unschedulable: false,
      is_on_critical_path: true,
      remaining_path_minutes: 30,
      remaining_path_known_minutes: 30,
      estimate_complete: true,
      due_risk: 'none',
      due_slack_minutes: null,
    },
  ],
  summary: {
    active_count: 1,
    pending_count: 1,
    in_progress_count: 0,
    completed_count: 0,
    cancelled_count: 0,
    ready_count: 1,
    blocked_count: 0,
    at_risk_count: 0,
    overdue_count: 0,
    orphan_count: 0,
    isolated_count: 1,
    critical_path_task_ids: ['task-1'],
    critical_path_minutes: 30,
    critical_path_known_minutes: 30,
    critical_path_estimate_complete: true,
    unknown_estimate_task_ids: [],
    unschedulable_task_ids: [],
    unschedulable_count: 0,
    cycle_count: 0,
    missing_dependency_count: 0,
    due_date_conflict_count: 0,
    unknown_estimate_count: 0,
    invalid_estimate_count: 0,
    parent_cycle_count: 0,
    missing_parent_count: 0,
    cancelled_prerequisite_count: 0,
    issue_count: 0,
    is_healthy: true,
  },
  issues: [],
  issues_truncated: false,
};

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('useTaskGraphInsightsQuery', () => {
  beforeEach(() => {
    apiMocks.get.mockReset();
    useAuthStore.setState({ serverUrl: 'https://host.example' });
  });

  it('loads and validates a project-scoped graph snapshot', async () => {
    apiMocks.get.mockResolvedValueOnce({ data: insights });
    const { result } = renderHook(() => useTaskGraphInsightsQuery('project-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiMocks.get).toHaveBeenCalledWith('/todos/graph/insights', {
      params: { limit: 2000, root_task_id: 'project-1' },
    });
    expect(result.current.data).toEqual(insights);
  });

  it('omits root_task_id for the global graph', async () => {
    apiMocks.get.mockResolvedValueOnce({
      data: { ...insights, scope: { ...insights.scope, root_task_id: null } },
    });
    const { result } = renderHook(() => useTaskGraphInsightsQuery(null), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiMocks.get).toHaveBeenCalledWith('/todos/graph/insights', {
      params: { limit: 2000 },
    });
  });

  it('fails closed when a derived execution enum drifts from the contract', async () => {
    apiMocks.get.mockResolvedValueOnce({
      data: {
        ...insights,
        nodes: [{ ...insights.nodes[0], execution_state: 'maybe_ready' }],
      },
    });
    const { result } = renderHook(() => useTaskGraphInsightsQuery(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it('keeps diagnostic snapshots readable when stored estimates are invalid', async () => {
    apiMocks.get.mockResolvedValueOnce({
      data: {
        ...insights,
        nodes: [{ ...insights.nodes[0], estimated_minutes: -15 }],
        summary: { ...insights.summary, invalid_estimate_count: 1, issue_count: 1 },
        issues: [
          {
            code: 'lifecycle_conflict',
            severity: 'warning',
            task_ids: ['task-1'],
            related_task_ids: [],
            message: 'Task state conflicts with its prerequisites',
          },
        ],
      },
    });
    const { result } = renderHook(() => useTaskGraphInsightsQuery(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.nodes[0].estimated_minutes).toBe(-15);
    expect(result.current.data?.issues[0].code).toBe('lifecycle_conflict');
  });
});
