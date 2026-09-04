import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentRunResponse, ReviewItemResponse } from '../../../types/api';
import ActionCard from '../ActionCard';

const queryMocks = vi.hoisted(() => ({
  awaitingInput: vi.fn(),
  reviews: vi.fn(),
  resume: vi.fn(),
  decide: vi.fn(),
  permission: vi.fn(),
  runNext: vi.fn(),
}));

vi.mock('../../../hooks/queries', () => ({
  useRunsAwaitingInputQuery: queryMocks.awaitingInput,
  useReviewsQuery: queryMocks.reviews,
  useResumeAgentRun: () => ({ mutate: queryMocks.resume, isPending: false }),
  useDecideReview: () => ({ mutate: queryMocks.decide, isPending: false }),
  useResolvePaseoPermission: () => ({ mutate: queryMocks.permission, isPending: false }),
  useRunReadyTaskWithProjectDefaults: () => ({
    runTask: queryMocks.runNext,
    canRunTask: () => true,
    isPending: false,
    isPreparing: false,
  }),
}));

const waitingRun = { id: 'run_1', status: 'waiting_input' } as AgentRunResponse;
const pendingReview = {
  id: 'review_1',
  subject_type: 'agent_run',
  subject_id: 'run_1',
  status: 'pending',
  metadata: { run_id: 'run_1' },
} as unknown as ReviewItemResponse;

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderCard(metadata: Record<string, unknown>, suppressTaskProgress = false) {
  return render(
    <MemoryRouter initialEntries={['/chats/conv_1']}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <ActionCard metadata={metadata} suppressTaskProgress={suppressTaskProgress} />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RunStatusCard', () => {
  beforeEach(() => {
    queryMocks.awaitingInput.mockReturnValue({ data: [] });
    queryMocks.reviews.mockReturnValue({ data: [] });
    queryMocks.resume.mockReset();
    queryMocks.decide.mockReset();
    queryMocks.permission.mockReset();
    queryMocks.runNext.mockReset();
  });

  it('renders structured choices and Paseo permission actions inline', () => {
    queryMocks.awaitingInput.mockReturnValue({ data: [waitingRun] });
    renderCard({
      action_type: 'run_update',
      status: 'waiting_input',
      run_id: 'run_1',
      input_options: ['Formal', 'Casual'],
      permissions: [{ id: 'permission-1', tool: 'shell' }],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Casual' }));
    expect(queryMocks.resume).toHaveBeenCalledWith({ runId: 'run_1', followUp: 'Casual' });
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(queryMocks.permission).toHaveBeenCalledWith({ runId: 'run_1', decision: 'allow' });
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(queryMocks.permission).toHaveBeenCalledWith({ runId: 'run_1', decision: 'deny' });
  });

  it('takes the answer in the thread while the run is still waiting for input', () => {
    queryMocks.awaitingInput.mockReturnValue({ data: [waitingRun] });
    renderCard({ action_type: 'run_update', status: 'waiting_input', run_id: 'run_1' });

    expect(screen.getByText('Needs your input')).toBeInTheDocument();
    const answer = screen.getByLabelText('Answer the agent');
    const send = screen.getByRole('button', { name: 'Send answer' });
    expect(send).toBeDisabled();
    fireEvent.change(answer, { target: { value: 'Casual tone' } });
    fireEvent.click(send);
    expect(queryMocks.resume).toHaveBeenCalledWith(
      { runId: 'run_1', followUp: 'Casual tone' },
      expect.anything(),
    );
  });

  it('turns into a record once the question has been answered', () => {
    renderCard({ action_type: 'run_update', status: 'waiting_input', run_id: 'run_1' });

    expect(screen.getByText('Already answered')).toBeInTheDocument();
    expect(screen.queryByLabelText('Answer the agent')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open run' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/runs?run_id=run_1');
  });

  it('decides a pending review from the thread, with the note as the follow-up', () => {
    queryMocks.reviews.mockReturnValue({ data: [pendingReview] });
    renderCard({ action_type: 'run_update', status: 'waiting_review', run_id: 'run_1' });

    expect(screen.getByText('Waiting for review')).toBeInTheDocument();
    const changes = screen.getByRole('button', { name: 'Request changes' });
    expect(changes).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Optional review note'), {
      target: { value: 'Shorter please' },
    });
    fireEvent.click(changes);
    expect(queryMocks.decide).toHaveBeenCalledWith({
      reviewId: 'review_1',
      decision: 'changes_requested',
      note: 'Shorter please',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(queryMocks.decide).toHaveBeenLastCalledWith(
      {
        reviewId: 'review_1',
        decision: 'approved',
        note: 'Shorter please',
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('offers one explicit next run after approval in the task thread', () => {
    queryMocks.reviews.mockReturnValue({
      data: [{ ...pendingReview, project_id: 'project-1', subject_title: 'Write draft' }],
    });
    queryMocks.runNext.mockResolvedValue({ run_id: 'run-next' });
    queryMocks.decide.mockImplementation(
      (
        _variables: unknown,
        options?: {
          onSuccess?: (result: {
            review: ReviewItemResponse;
            agentRunOutcome: {
              todo_id: string;
              todo_status: 'completed';
              graph_revision: number;
              newly_ready_tasks: Array<{ id: string; title: string }>;
            };
          }) => void;
        },
      ) =>
        options?.onSuccess?.({
          review: {
            ...pendingReview,
            project_id: 'project-1',
            subject_title: 'Write draft',
          },
          agentRunOutcome: {
            todo_id: 'task-1',
            todo_status: 'completed',
            graph_revision: 8,
            newly_ready_tasks: [{ id: 'task-next', title: 'Publish draft' }],
          },
        }),
    );

    renderCard({ action_type: 'run_update', status: 'waiting_review', run_id: 'run_1' });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(screen.getByLabelText('Agent approval outcome')).toHaveTextContent(
      '1 downstream task is now Ready.',
    );
    expect(queryMocks.runNext).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Run next' }));
    expect(queryMocks.runNext).toHaveBeenCalledWith('task-next', 'project-1');
  });

  it('shows the failure and a way to the run, and nothing to click for settled states', () => {
    const { unmount } = renderCard({
      action_type: 'run_update',
      status: 'failed',
      run_id: 'run_1',
      error: 'Provider timeout',
      host_label: 'ubuntu-lab',
    });
    expect(screen.getByText('Provider timeout')).toBeInTheDocument();
    expect(screen.getByText(/on ubuntu-lab/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open run' })).toBeInTheDocument();
    unmount();

    renderCard({ action_type: 'run_update', status: 'completed', run_id: 'run_1' });
    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('folds the live delegation card after a durable run card exists', () => {
    const { container } = renderCard(
      { action_type: 'task_delegated', task_id: 'task_1', run_id: 'run_1' },
      true,
    );
    expect(container.querySelector('.cc-task-progress')).not.toBeInTheDocument();
  });
});
