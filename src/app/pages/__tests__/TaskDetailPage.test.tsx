import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TaskDetailPage from '../TaskDetailPage';

const mocks = vi.hoisted(() => ({
  projectDescription: null as string | null,
  updateTodo: vi.fn(),
  deleteTodo: vi.fn(),
  toggleTodo: vi.fn(),
  persist: vi.fn(),
  projectPath: '/Users/test/papers' as string | null,
  hostLabel: 'My Mac' as string | null,
  projectError: false,
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
  recurrence_rule: null as string | null,
  recurrence_end: null,
  created_at: '2026-09-04T00:00:00Z',
  updated_at: '2026-09-04T00:00:00Z',
};

vi.mock('../../hooks/queries', () => ({
  queryKeys: { todos: ['todos'] },
  useTodosQuery: () => ({ data: [task, { ...task, id: 'other-task', title: 'Other task' }] }),
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
          execution_host_label: mocks.hostLabel,
          execution_host_online: true,
          execution_workspace_path: mocks.projectPath,
        }
      : undefined,
    isError: mocks.projectError,
  }),
}));

vi.mock('../../hooks/useDebouncedPersist', () => ({
  useDebouncedPersist: () => mocks.persist,
}));

vi.mock('../../hooks/useExperimentCompletionGate', () => ({
  default: () => ({ requestStatusChange: vi.fn(), confirmationDialog: null }),
}));

vi.mock('../../components/task-detail/TaskAgentThreadSection', () => ({
  default: () => <div>Agent thread</div>,
}));
vi.mock('../../components/task-relationships/RelationshipsSection', () => ({
  default: () => null,
}));
vi.mock('../../components/shared/FileDropZone', () => ({ default: () => null }));
vi.mock('../../components/shared/AttachmentList', () => ({ default: () => null }));
vi.mock('../../components/shared/ProjectWorkspaceHosts', () => ({
  default: ({ projectId }: { projectId: string }) => <div>Workspace editor: {projectId}</div>,
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/tasks/todo-e65a']}>
        <Link to="/tasks/other-task">Other task</Link>
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
    mocks.persist.mockReset();
    task.recurrence_rule = null;
    mocks.projectPath = '/Users/test/papers';
    mocks.hostLabel = 'My Mac';
    mocks.projectError = false;
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

  it('shows the project path before opening details and edits it without opening chat', () => {
    renderPage();
    expect(screen.getByText('/Users/test/papers')).toBeVisible();
    expect(screen.getByText('Runs on My Mac')).toBeVisible();
    expect(screen.getByRole('link', { name: 'P0-R Semantic referent binding' })).toHaveAttribute(
      'href',
      '/projects/project-p0-r',
    );
    expect(screen.getByText('Workspace editor: project-p0-r')).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Change where this runs' }));
    expect(screen.getByText('Workspace editor: project-p0-r')).toBeVisible();
    expect(screen.getByPlaceholderText('Task title')).toBeVisible();
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it('shows missing location explicitly and offers the same editor', () => {
    mocks.projectPath = null;
    mocks.hostLabel = null;
    renderPage();
    expect(screen.getByText('Not set up')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Choose machine' }));
    expect(screen.getByText('Workspace editor: project-p0-r')).toBeVisible();
  });

  it('does not present a failed project lookup as an unset workspace', () => {
    mocks.projectError = true;
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent('This project could not be loaded.');
    expect(screen.queryByText('Not set up')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose machine' })).not.toBeInTheDocument();
  });

  it('refreshes the visible path and resets the editor when switching tasks', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Change where this runs' }));
    mocks.projectPath = '/Users/test/new-folder';
    fireEvent.click(screen.getByRole('link', { name: 'Other task' }));
    expect(screen.getByText('/Users/test/new-folder')).toBeVisible();
    expect(screen.queryByText('/Users/test/papers')).not.toBeInTheDocument();
    expect(screen.getByText('Workspace editor: project-p0-r')).not.toBeVisible();
  });

  it('collapses optional settings without hiding the next action or thread', () => {
    renderPage();
    expect(screen.getByText('Agent thread')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Discuss with agent' })).toBeVisible();
    expect(screen.queryByText('Repeat')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Research' })).not.toBeVisible();
    fireEvent.click(screen.getByText('Skills:'));
    fireEvent.click(screen.getByRole('button', { name: 'Research' }));
    expect(mocks.persist).toHaveBeenCalledWith({
      enabled_skills: ['research'],
      assignee: 'research',
    });
  });

  it('does not offer recurrence even for a legacy recurring task', () => {
    task.recurrence_rule = 'RRULE:FREQ=WEEKLY';
    renderPage();
    expect(screen.queryByText('Repeat')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Task title')).toBeVisible();
  });

  it('exposes details accessibly and resets disclosure when changing tasks', () => {
    renderPage();
    const details = screen.getByRole('button', { name: /Details/ });
    expect(details).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(details);
    expect(details).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByPlaceholderText('Add a description...')).toBeVisible();
    fireEvent.click(screen.getByRole('link', { name: 'Other task' }));
    expect(screen.getByRole('button', { name: /Details/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByPlaceholderText('Add a description...')).not.toBeInTheDocument();
  });
});
