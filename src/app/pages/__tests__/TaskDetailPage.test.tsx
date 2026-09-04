import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TaskDetailPage from '../TaskDetailPage';

const mocks = vi.hoisted(() => ({
  projectDescription: null as string | null,
  updateTodo: vi.fn(),
  deleteTodo: vi.fn(),
  toggleTodo: vi.fn(),
}));

const task = {
  id: 'todo-e65a',
  title: 'E65a Run planner boundary probe',
  description: '/home/research/task-note.md',
  project_id: 'project-p0-r',
  status: 'pending',
  priority: 'medium',
  due_date: null,
  completed_at: null,
  tags: ['exp/E65a', 'branch/P0-R', 'repo/srp'],
  parent_id: null,
  sort_order: 0,
  source: null,
  source_id: null,
  idempotency_key: null,
  assignee: null,
  enabled_skills: null,
  inbox_state: 'none',
  estimated_minutes: null,
  depends_on: null,
  recurrence_rule: null,
  recurrence_end: null,
  created_at: '2026-09-04T00:00:00Z',
  updated_at: '2026-09-04T00:00:00Z',
};

vi.mock('../../hooks/queries', () => ({
  queryKeys: { todos: ['todos'] },
  useTodosQuery: () => ({ data: [task] }),
  useUpdateTodo: () => ({ mutate: mocks.updateTodo }),
  useDeleteTodo: () => ({ mutate: mocks.deleteTodo }),
  useToggleTodoComplete: () => ({ mutate: mocks.toggleTodo }),
  useLatestPlanProposalQuery: () => ({ data: null }),
  useGeneratePlanProposal: () => ({ mutateAsync: vi.fn(), reset: vi.fn() }),
  useApplyPlanProposal: () => ({ mutateAsync: vi.fn(), reset: vi.fn() }),
  useDismissPlanProposal: () => ({ mutateAsync: vi.fn() }),
  useGetOrCreateProjectConversation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useProjectQuery: (projectId: string | undefined) => ({
    data: projectId
      ? {
          id: projectId,
          title: 'P0-R Semantic referent binding',
          description: mocks.projectDescription,
        }
      : undefined,
  }),
}));

vi.mock('../../hooks/useDebouncedPersist', () => ({
  useDebouncedPersist: () => vi.fn(),
}));

vi.mock('../../hooks/useExperimentCompletionGate', () => ({
  default: () => ({ requestStatusChange: vi.fn(), confirmationDialog: null }),
}));

vi.mock('../../components/task-detail/TaskAgentThreadSection', () => ({
  default: () => <div>Agent thread</div>,
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/tasks/todo-e65a']}>
        <Routes>
          <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TaskDetailPage project context', () => {
  beforeEach(() => {
    mocks.projectDescription = null;
    mocks.updateTodo.mockReset();
    mocks.deleteTodo.mockReset();
    mocks.toggleTodo.mockReset();
  });

  it('shows the original-document action from the project description first line', () => {
    mocks.projectDescription = '/home/research/E65.md\nAdditional project context';

    renderPage();

    expect(screen.getByText('Project context')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open original document' })).toBeVisible();
  });

  it('does not use a task description path when the project has no canonical document', () => {
    renderPage();

    expect(screen.getByText('Project context')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Open original document' }),
    ).not.toBeInTheDocument();
  });
});
