import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../../stores/useAuthStore';
import type { PlanProposalResponse } from '../../../types/api';
import ActionCard from '../ActionCard';

const apiMocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('../../../services/apiClient', () => ({ default: apiMocks }));

const proposal: PlanProposalResponse = {
  proposal_id: 'proposal-1',
  task_id: 'proposal-1',
  agent_task_id: null,
  todo_id: 'todo-1',
  base_graph_revision: 7,
  status: 'draft',
  validation: { errors: [], warnings: [] },
  diff: { add_task_count: 2, add_relationship_count: 1, root_update_fields: [] },
  summary: 'Add two focused steps',
  suggested_root_due_date: null,
  suggested_assignee: null,
  suggested_skills: null,
  suggested_project_title: null,
  subtasks: [
    { title: 'Desktop panel', depends_on_indices: [] },
    { title: 'Mobile panel', depends_on_indices: [0] },
  ],
  subtask_count: 2,
  suggested_due_summary: null,
  suggested_assignee_label: null,
  suggested_skills_labels: null,
  suggested_project_label: null,
  created_at: '2026-09-04T01:00:01',
};

const metadata = {
  action_type: 'plan_started',
  todo_id: 'todo-1',
  todo_title: 'Project Agent panel',
  plan_requested_at: '2026-09-04T01:00:00+00:00',
  plan_proposal_id: 'proposal-1',
};

function renderCard(cardMetadata: Record<string, unknown> = metadata) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<ActionCard metadata={cardMetadata} />, { wrapper });
}

describe('chat graph proposal card', () => {
  it('identifies discovered work as a proposal that does not alter the run', async () => {
    renderCard({ ...metadata, discovered_from_task_id: 'running-task' });
    expect(
      await screen.findByText(
        'Follow-up work. Applying this proposal does not change the current run.',
      ),
    ).toBeInTheDocument();
    expect(apiMocks.post).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    apiMocks.get.mockReset().mockResolvedValue({ data: proposal });
    apiMocks.post.mockReset();
    useAuthStore.setState({ serverUrl: 'https://host.example' });
  });

  it('reviews and applies the generated proposal inside chat', async () => {
    apiMocks.post.mockResolvedValueOnce({
      data: {
        todo_id: 'todo-1',
        proposal_id: 'proposal-1',
        change_set_id: 'change-set-1',
        applied_graph_revision: 8,
        created_subtask_ids: ['todo-2', 'todo-3'],
        created_relationships: 1,
        root_update_fields: [],
        project_folder_created: null,
        already_applied: false,
        can_undo: true,
        vault_sync_status: 'pending',
      },
    });
    renderCard();

    expect(await screen.findByText('Add two focused steps')).toBeInTheDocument();
    expect(apiMocks.get).toHaveBeenCalledWith('/todos/todo-1/plan/proposals/proposal-1');
    fireEvent.click(screen.getByRole('button', { name: 'Apply (2/2)' }));

    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith(
        '/todos/todo-1/plan/apply',
        {
          proposal_id: 'proposal-1',
          base_graph_revision: 7,
          selected_indices: [0, 1],
          subtasks: proposal.subtasks,
        },
        { queueOfflineMutation: false },
      ),
    );
  });

  it('does not mistake an older task proposal for the new chat request', async () => {
    apiMocks.get.mockResolvedValue({
      data: { ...proposal, created_at: '2026-09-04T00:59:59Z' },
    });
    renderCard({ ...metadata, plan_proposal_id: undefined });

    expect(await screen.findByText('Preparing a graph change proposal…')).toBeInTheDocument();
    expect(screen.queryByText('Add two focused steps')).not.toBeInTheDocument();
  });

  it('does not turn a stale direct add into a broader AI-generated plan', async () => {
    apiMocks.get.mockResolvedValue({ data: { ...proposal, status: 'stale' } });
    renderCard({ ...metadata, proposal_kind: 'add_task' });

    expect(await screen.findByText('Ask the agent to propose this change again.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Regenerate' })).not.toBeInTheDocument();
  });
});
