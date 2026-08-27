import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanProposalResponse, TodoResponse } from '../../../types/api';
import TaskGraphProposalDialog from '../TaskGraphProposalDialog';

const apiMocks = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock('../../../services/apiClient', () => ({ default: apiMocks }));
vi.mock('../../../hooks/usePlatform', () => ({
  default: () => ({ isMobile: false }),
}));
vi.mock('../TaskGraphView', () => ({
  default: () => <div data-testid="proposal-graph" />,
}));
vi.mock('../../shared/Dialog', () => ({
  default: ({
    children,
    title,
  }: {
    children: ReactNode;
    title?: string;
    onOpenChange: (open: boolean) => void;
  }) => (
    <div role="dialog" aria-label={title}>
      {children}
    </div>
  ),
}));

const target: TodoResponse = {
  id: 'task-1',
  title: 'Ship MVP',
  status: 'pending',
  created_at: '2026-08-27T00:00:00Z',
  updated_at: '2026-08-27T00:00:00Z',
};

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
    { title: 'Research', priority: 'high', depends_on_indices: [] },
    { title: 'Build', priority: 'medium', depends_on_indices: [0] },
  ],
  subtask_count: 2,
  suggested_due_summary: null,
  suggested_assignee_label: null,
  suggested_skills_labels: null,
  suggested_project_label: null,
  created_at: '2026-08-27T00:00:00Z',
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('TaskGraphProposalDialog', () => {
  beforeEach(() => {
    apiMocks.post.mockReset();
  });

  it('sends exact proposal identity/revision and keeps a stale conflict open', async () => {
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
    apiMocks.post
      .mockResolvedValueOnce({ data: proposal })
      .mockRejectedValueOnce(staleError)
      .mockRejectedValueOnce(new Error('provider offline'));
    const onOpenChange = vi.fn();

    render(<TaskGraphProposalDialog targets={[target]} onOpenChange={onOpenChange} />, {
      wrapper: createWrapper(),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Generate proposal' }));
    await screen.findByText('Research, then build');
    expect(screen.getByLabelText('Authoritative proposal diff')).toHaveTextContent(
      '2 tasks to add',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Approve and create 2' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'task graph changed after this proposal was created',
      ),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Proposal revision 7');
    expect(screen.getByRole('button', { name: 'Approve and create 2' })).toBeDisabled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(apiMocks.post).toHaveBeenNthCalledWith(
      2,
      '/todos/task-1/plan/apply',
      {
        proposal_id: 'proposal-1',
        base_graph_revision: 7,
        selected_indices: [0, 1],
        subtasks: proposal.subtasks,
      },
      { queueOfflineMutation: false },
    );

    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Regenerate' }));
    await waitFor(() => expect(apiMocks.post).toHaveBeenCalledTimes(3));
    expect(screen.getByRole('alert')).toHaveTextContent('task graph changed');
    expect(screen.getByRole('button', { name: 'Approve and create 2' })).toBeDisabled();
  });

  it('fails closed when generation returns status stale with HTTP 200', async () => {
    apiMocks.post.mockResolvedValueOnce({ data: { ...proposal, status: 'stale' } });

    render(<TaskGraphProposalDialog targets={[target]} onOpenChange={vi.fn()} />, {
      wrapper: createWrapper(),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Generate proposal' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('task graph changed');
    expect(screen.getByRole('button', { name: 'Approve and create 2' })).toBeDisabled();
  });
});
