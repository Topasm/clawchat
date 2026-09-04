import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReviewDecisionResult } from '../../hooks/queries';
import type { ReviewItemResponse } from '../../types/api';
import ReviewPage from '../ReviewPage';

const queryMocks = vi.hoisted(() => ({
  decide: vi.fn(),
  reviews: vi.fn(),
  runNext: vi.fn(),
}));
const routerMocks = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock('../../hooks/queries', () => ({
  useReviewsQuery: queryMocks.reviews,
  useDecideReview: () => ({ mutate: queryMocks.decide, isPending: false }),
  useRunReadyTaskWithProjectDefaults: () => ({
    runTask: queryMocks.runNext,
    canRunTask: () => true,
    isPending: false,
    isPreparing: false,
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => routerMocks.navigate };
});

const reviewItem: ReviewItemResponse = {
  id: 'review-1',
  project_id: 'project-1',
  project_title: 'Research',
  subject_type: 'agent_run',
  subject_id: 'run-1',
  subject_title: 'Run experiment',
  subject_description: 'The experiment completed successfully.',
  subject_href: '/runs?run_id=run-1',
  status: 'pending',
  summary: 'Review the experiment result',
  risk_level: 'medium',
  requested_at: '2026-08-28T00:00:00Z',
  reviewed_at: null,
  review_note: null,
  metadata: {
    approval_impact: {
      todo_id: 'task-run',
      graph_revision: 17,
      newly_ready_tasks: [{ id: 'task-analysis', title: 'Analyze experiment' }],
    },
  },
};

const decisionResult: ReviewDecisionResult = {
  review: { ...reviewItem, status: 'approved', reviewed_at: '2026-08-28T01:00:00Z' },
  outcome: {
    run_id: 'run-1',
    agent_task_id: 'agent-task-1',
    todo_id: 'task-run',
    todo_status: 'completed',
    graph_revision: 18,
    newly_ready_tasks: [{ id: 'task-analysis', title: 'Analyze experiment' }],
    adopted: true,
  },
  agentRunOutcome: {
    run_id: 'run-1',
    agent_task_id: 'agent-task-1',
    todo_id: 'task-run',
    todo_status: 'completed',
    graph_revision: 18,
    newly_ready_tasks: [{ id: 'task-analysis', title: 'Analyze experiment' }],
    adopted: true,
  },
};

describe('ReviewPage Agent Run handoff', () => {
  beforeEach(() => {
    queryMocks.decide.mockReset();
    queryMocks.reviews.mockReset();
    queryMocks.runNext.mockReset();
    queryMocks.runNext.mockResolvedValue({ run_id: 'run-next' });
    routerMocks.navigate.mockReset();
    queryMocks.reviews.mockReturnValue({ data: [reviewItem], isLoading: false });
    queryMocks.decide.mockImplementation(
      (_variables: unknown, options?: { onSuccess?: (result: ReviewDecisionResult) => void }) =>
        options?.onSuccess?.(decisionResult),
    );
  });

  it('shows approval impact, then keeps the applied handoff available after approval', () => {
    render(
      <MemoryRouter initialEntries={['/review']}>
        <ReviewPage />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText('Agent approval impact')).toHaveTextContent(
      '1 downstream task will become Ready.',
    );
    fireEvent.change(screen.getByLabelText('Review note for Run experiment'), {
      target: { value: 'Looks good' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(queryMocks.decide).toHaveBeenCalledWith(
      { reviewId: 'review-1', decision: 'approved', note: 'Looks good' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(screen.getByLabelText('Agent approval outcome')).toHaveTextContent(
      '1 downstream task is now Ready.',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open Analyze experiment' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose another' }));
    fireEvent.click(screen.getByRole('button', { name: 'Run next' }));

    expect(routerMocks.navigate).toHaveBeenNthCalledWith(1, '/tasks/task-analysis');
    expect(routerMocks.navigate).toHaveBeenNthCalledWith(2, '/projects/project-1');
    expect(queryMocks.runNext).toHaveBeenCalledWith('task-analysis', 'project-1');
  });

  it('does not offer a duplicate changes request for an item already waiting on input', () => {
    queryMocks.reviews.mockReturnValue({
      data: [{ ...reviewItem, status: 'changes_requested' }],
      isLoading: false,
    });

    render(
      <MemoryRouter initialEntries={['/review?status=changes_requested']}>
        <ReviewPage />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('button', { name: 'Request changes' })).not.toBeInTheDocument();
    expect(
      screen.getByText(/Items with a note resume automatically and move back to the run thread/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
  });
});
