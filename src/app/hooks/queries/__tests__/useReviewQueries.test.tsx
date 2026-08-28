import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useToastStore } from '../../../stores/useToastStore';
import { queryKeys } from '../queryKeys';
import { useDecideReview } from '../useReviewQueries';

const apiMocks = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock('../../../services/apiClient', () => ({ default: apiMocks }));

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  for (const key of [
    queryKeys.reviews,
    queryKeys.projects,
    queryKeys.todos,
    queryKeys.taskGraphInsights,
    queryKeys.runs,
    queryKeys.taskExecutionTelemetry,
  ]) {
    queryClient.setQueryData(key, {});
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

function review(subjectType: 'agent_run' | 'artifact_revision') {
  return {
    id: 'review-1',
    project_id: 'project-1',
    project_title: 'Research',
    subject_type: subjectType,
    subject_id: 'subject-1',
    subject_title: 'Run experiment',
    subject_description: null,
    subject_href: null,
    status: 'approved',
    summary: 'Review the result',
    risk_level: 'medium',
    requested_at: '2026-08-28T00:00:00Z',
    reviewed_at: '2026-08-28T01:00:00Z',
    review_note: null,
    metadata: {},
  };
}

describe('useDecideReview', () => {
  beforeEach(() => {
    apiMocks.post.mockReset();
    useToastStore.setState({ toasts: [] });
  });

  it('returns a typed Agent Run outcome and invalidates graph insights after approval', async () => {
    apiMocks.post.mockResolvedValue({
      data: {
        review: review('agent_run'),
        outcome: {
          run_id: 'run-1',
          agent_task_id: 'agent-task-1',
          todo_id: 'task-run',
          todo_status: 'completed',
          graph_revision: 18,
          newly_ready_tasks: [{ id: 'task-report', title: 'Draft report' }],
          adopted: true,
        },
      },
    });
    const { queryClient, wrapper } = createHarness();
    const { result } = renderHook(() => useDecideReview(), { wrapper });

    let response: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      response = await result.current.mutateAsync({
        reviewId: 'review-1',
        decision: 'approved',
      });
    });

    expect(apiMocks.post).toHaveBeenCalledWith('/reviews/review-1/decision', {
      decision: 'approved',
      note: undefined,
    });
    expect(response?.agentRunOutcome?.newly_ready_tasks).toEqual([
      { id: 'task-report', title: 'Draft report' },
    ]);
    expect(queryClient.getQueryState(queryKeys.taskGraphInsights)?.isInvalidated).toBe(true);
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe(
      'Agent result approved · 1 task now Ready',
    );
  });

  it('keeps non-Agent review outcomes generic', async () => {
    apiMocks.post.mockResolvedValue({
      data: {
        review: review('artifact_revision'),
        outcome: { artifact_id: 'artifact-1', version: 2 },
      },
    });
    const { wrapper } = createHarness();
    const { result } = renderHook(() => useDecideReview(), { wrapper });

    let response: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      response = await result.current.mutateAsync({
        reviewId: 'review-1',
        decision: 'approved',
      });
    });

    expect(response?.outcome).toEqual({ artifact_id: 'artifact-1', version: 2 });
    expect(response?.agentRunOutcome).toBeNull();
  });
});
