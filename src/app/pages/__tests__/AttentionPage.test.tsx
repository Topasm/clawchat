import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentRunResponse, ReviewItemResponse } from '../../types/api';
import AttentionPage from '../AttentionPage';

const queryMocks = vi.hoisted(() => ({
  awaitingInput: vi.fn(),
  reviews: vi.fn(),
  runs: vi.fn(),
  decide: vi.fn(),
  resume: vi.fn(),
  retry: vi.fn(),
  runNext: vi.fn(),
}));
const routerMocks = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock('../../hooks/queries', () => ({
  useRunsAwaitingInputQuery: queryMocks.awaitingInput,
  useReviewsQuery: queryMocks.reviews,
  useAgentRunsQuery: queryMocks.runs,
  useDecideReview: () => ({ mutate: queryMocks.decide, isPending: false }),
  useResumeAgentRun: () => ({ mutate: queryMocks.resume, isPending: false }),
  useRetryAgentRun: () => ({ mutate: queryMocks.retry, isPending: false }),
  useCancelAgentRun: () => ({ mutate: vi.fn(), isPending: false }),
  useReturnAgentRunToReady: () => ({ mutate: vi.fn(), isPending: false }),
  useAgentRunEventsQuery: () => ({ data: [], isLoading: false }),
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

function run(overrides: Partial<AgentRunResponse>): AgentRunResponse {
  return {
    id: 'run-1',
    agent_task_id: 'agent-task-1',
    project_id: 'project-1',
    project_title: 'Research',
    todo_id: 'task-1',
    todo_title: 'Compare vendors',
    todo_status: 'in_progress',
    conversation_id: 'conv-1',
    task_type: 'research',
    instruction: 'Compare vendors',
    instruction_snapshot: 'Compare vendors',
    attempt: 1,
    provider: 'openclaw',
    model: null,
    host_id: null,
    workspace_id: null,
    external_run_id: null,
    status: 'waiting_input',
    progress: 50,
    progress_message: 'Include used equipment?',
    result_summary: null,
    error: null,
    usage: null,
    is_adopted: false,
    created_at: '2026-09-04T10:00:00Z',
    started_at: '2026-09-04T10:00:00Z',
    heartbeat_at: '2026-09-04T10:05:00Z',
    completed_at: null,
    cancel_requested_at: null,
    updated_at: '2026-09-04T10:05:00Z',
    ...overrides,
  };
}

const reviewItem = {
  id: 'review-1',
  project_id: 'project-1',
  project_title: 'Research',
  subject_type: 'agent_run',
  subject_id: 'run-2',
  subject_title: 'Draft the summary',
  subject_description: 'Here is the summary.',
  subject_href: '/chats/conv-2',
  status: 'pending',
  summary: 'Review draft result',
  risk_level: 'medium',
  requested_at: '2026-09-04T10:10:00Z',
  reviewed_at: null,
  review_note: null,
  metadata: { run_id: 'run-2' },
} as ReviewItemResponse;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/attention']}>
      <AttentionPage />
    </MemoryRouter>,
  );
}

describe('AttentionPage', () => {
  beforeEach(() => {
    queryMocks.decide.mockReset();
    queryMocks.resume.mockReset();
    queryMocks.runNext.mockReset();
    routerMocks.navigate.mockReset();
    queryMocks.awaitingInput.mockReturnValue({ data: [], isLoading: false });
    queryMocks.reviews.mockReturnValue({ data: [], isLoading: false });
    queryMocks.runs.mockReturnValue({ data: [], isLoading: false });
  });

  it('says so when nothing has stopped for the user, counting what is still running', () => {
    queryMocks.runs.mockReturnValue({
      data: [run({ id: 'run-9', status: 'running' })],
      isLoading: false,
    });
    renderPage();
    expect(
      screen.getByText('Nothing needs you right now. 1 runs in progress.'),
    ).toBeInTheDocument();
  });

  it('groups questions, reviews and failed runs, each acted on in place', () => {
    const waiting = run({});
    const failed = run({
      id: 'run-3',
      status: 'failed',
      todo_title: 'Sync the vault',
      error: 'No heartbeat for 10 minutes',
      conversation_id: 'conv-3',
      host_label: 'ubuntu-lab',
    });
    queryMocks.awaitingInput.mockReturnValue({ data: [waiting], isLoading: false });
    queryMocks.reviews.mockReturnValue({ data: [reviewItem], isLoading: false });
    queryMocks.runs.mockReturnValue({ data: [waiting, failed], isLoading: false });
    renderPage();

    expect(screen.getByRole('region', { name: 'Needs your input' })).toHaveTextContent(
      'Compare vendors',
    );
    expect(screen.getByRole('region', { name: 'Needs your review' })).toHaveTextContent(
      'Draft the summary',
    );
    expect(screen.getByRole('region', { name: 'Needs a decision' })).toHaveTextContent(
      'Sync the vault',
    );
    // Where it ran is part of deciding what to do about it.
    expect(screen.getByRole('region', { name: 'Needs a decision' })).toHaveTextContent(
      'on ubuntu-lab',
    );

    fireEvent.change(screen.getByLabelText('Answer the agent'), {
      target: { value: 'Yes, include used' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Resume with follow-up' }));
    expect(queryMocks.resume).toHaveBeenCalledWith({
      runId: 'run-1',
      followUp: 'Yes, include used',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(queryMocks.decide).toHaveBeenCalledWith(
      { reviewId: 'review-1', decision: 'approved', note: undefined },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(queryMocks.retry).toHaveBeenCalledWith({ runId: 'run-3' });

    fireEvent.click(screen.getAllByRole('button', { name: 'Open thread' })[0]);
    expect(routerMocks.navigate).toHaveBeenCalledWith('/chats/conv-1');
  });

  it('keeps the log and the history one click away', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'All runs' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review history' }));
    expect(routerMocks.navigate).toHaveBeenNthCalledWith(1, '/runs');
    expect(routerMocks.navigate).toHaveBeenNthCalledWith(2, '/review?status=approved');
  });
});
