import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useToastStore } from '../../../stores/useToastStore';
import type { PlanProposalResponse } from '../../../types/api';
import { queryKeys } from '../queryKeys';
import {
  getPlanProposalMutationError,
  useApplyPlanProposal,
  useDismissPlanProposal,
  useGeneratePlanProposal,
  useLatestPlanProposalQuery,
  usePlanProposalQuery,
} from '../usePlanProposalQueries';

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock('../../../services/apiClient', () => ({
  default: apiMocks,
}));

const proposal: PlanProposalResponse = {
  proposal_id: 'proposal-1',
  task_id: 'proposal-1',
  agent_task_id: null,
  todo_id: 'task-1',
  base_graph_revision: 7,
  status: 'draft',
  validation: { errors: [], warnings: [] },
  diff: {
    add_task_count: 2,
    add_relationship_count: 1,
    root_update_fields: ['due_date'],
  },
  summary: 'Research, then build',
  suggested_root_due_date: null,
  suggested_assignee: null,
  suggested_skills: null,
  suggested_project_title: null,
  subtasks: [
    { title: 'Research', depends_on_indices: [] },
    { title: 'Build', depends_on_indices: [0] },
  ],
  subtask_count: 2,
  suggested_due_summary: null,
  suggested_assignee_label: null,
  suggested_skills_labels: null,
  suggested_project_label: null,
  created_at: '2026-08-27T00:00:00Z',
};

const applyResponse = {
  todo_id: 'task-1',
  proposal_id: 'proposal-1',
  change_set_id: 'change-set-1',
  applied_graph_revision: 8,
  created_subtask_ids: ['task-2', 'task-3'],
  created_relationships: 1,
  root_update_fields: ['due_date'],
  project_folder_created: null,
  already_applied: false,
  can_undo: true,
  vault_sync_status: 'pending',
};

const undoResponse = {
  change_set_id: 'change-set-1',
  proposal_id: 'proposal-1',
  todo_id: 'task-1',
  reverted_graph_revision: 9,
  reverted_subtask_ids: ['task-2', 'task-3'],
  already_reverted: false,
  vault_sync_status: 'succeeded',
};

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  queryClient.setQueryData(queryKeys.todos, []);
  queryClient.setQueryData(queryKeys.today, {});
  queryClient.setQueryData(queryKeys.taskRelationships, []);

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('versioned plan proposal queries', () => {
  beforeEach(() => {
    apiMocks.get.mockReset();
    apiMocks.post.mockReset();
    useAuthStore.setState({ serverUrl: 'https://host.example' });
    useToastStore.setState({ toasts: [] });
  });

  it('parses and caches the canonical latest proposal', async () => {
    apiMocks.get.mockResolvedValueOnce({ data: proposal });
    const { queryClient, wrapper } = createHarness();
    const { result } = renderHook(() => useLatestPlanProposalQuery('task-1'), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(proposal));

    expect(apiMocks.get).toHaveBeenCalledWith('/todos/task-1/plan/latest');
    expect(queryClient.getQueryData(queryKeys.latestPlanProposal('task-1'))).toEqual(proposal);
  });

  it('loads one exact proposal for a chat action card', async () => {
    apiMocks.get.mockResolvedValueOnce({ data: proposal });
    const { wrapper } = createHarness();
    const { result } = renderHook(() => usePlanProposalQuery('task-1', 'proposal-1'), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(proposal));

    expect(apiMocks.get).toHaveBeenCalledWith('/todos/task-1/plan/proposals/proposal-1');
  });

  it('opts generation out of the offline queue and stores both proposal cache paths', async () => {
    apiMocks.post.mockResolvedValueOnce({ data: proposal });
    const { queryClient, wrapper } = createHarness();
    const { result } = renderHook(() => useGeneratePlanProposal(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ todoId: 'task-1', instructions: '  Keep it small  ' });
    });

    expect(apiMocks.post).toHaveBeenCalledWith(
      '/todos/task-1/plan/generate',
      { instructions: 'Keep it small' },
      { queueOfflineMutation: false },
    );
    expect(queryClient.getQueryData(queryKeys.latestPlanProposal('task-1'))).toEqual(proposal);
    expect(queryClient.getQueryData(queryKeys.planProposal('proposal-1'))).toEqual(proposal);
  });

  it('sends exact proposal identity and revision, invalidates graph data, and exposes Undo', async () => {
    apiMocks.post
      .mockResolvedValueOnce({ data: applyResponse })
      .mockResolvedValueOnce({ data: undoResponse });
    const { queryClient, wrapper } = createHarness();
    const { result } = renderHook(() => useApplyPlanProposal(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        todoId: 'task-1',
        proposalId: 'proposal-1',
        baseGraphRevision: 7,
        selectedIndices: [0, 1],
        subtasks: proposal.subtasks,
      });
    });

    expect(apiMocks.post).toHaveBeenNthCalledWith(
      1,
      '/todos/task-1/plan/apply',
      {
        proposal_id: 'proposal-1',
        base_graph_revision: 7,
        selected_indices: [0, 1],
        subtasks: proposal.subtasks,
      },
      { queueOfflineMutation: false },
    );
    expect(queryClient.getQueryState(queryKeys.taskRelationships)?.isInvalidated).toBe(true);

    const successToast = useToastStore.getState().toasts.at(-1);
    expect(successToast?.action?.label).toBe('Undo');
    act(() => successToast?.action?.onClick());

    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenNthCalledWith(
        2,
        '/change-sets/change-set-1/revert',
        undefined,
        { queueOfflineMutation: false },
      ),
    );
  });

  it('normalizes stale 409 details without replacing inline feedback with a toast', async () => {
    const staleError = {
      response: {
        status: 409,
        data: {
          error: {
            code: 'STALE_PLAN_PROPOSAL',
            message: 'The graph changed',
            details: { base_revision: 7, current_revision: 9 },
          },
        },
      },
    };
    apiMocks.post.mockRejectedValueOnce(staleError);
    const { wrapper } = createHarness();
    const { result } = renderHook(() => useApplyPlanProposal(), { wrapper });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          todoId: 'task-1',
          proposalId: 'proposal-1',
          baseGraphRevision: 7,
          selectedIndices: [0],
        });
      }),
    ).rejects.toBe(staleError);

    expect(getPlanProposalMutationError(staleError)).toEqual({
      status: 409,
      code: 'STALE_PLAN_PROPOSAL',
      message: 'The graph changed',
      staleDetails: { base_revision: 7, current_revision: 9 },
    });
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it('opts dismiss mutations out of offline queueing', async () => {
    apiMocks.post.mockResolvedValueOnce({
      data: { status: 'rejected', todo_id: 'task-1', proposal_id: 'proposal-1' },
    });
    const { wrapper } = createHarness();
    const { result: dismiss } = renderHook(() => useDismissPlanProposal(), { wrapper });

    await act(async () => {
      await dismiss.current.mutateAsync({ todoId: 'task-1', proposalId: 'proposal-1' });
    });

    expect(apiMocks.post).toHaveBeenNthCalledWith(
      1,
      '/todos/task-1/plan/dismiss',
      { proposal_id: 'proposal-1' },
      { queueOfflineMutation: false },
    );
  });
});
