import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TaskDetailPage from '../TaskDetailPage';
import TaskDetail from '../../components/task-detail/TaskDetail';
import { useToastStore } from '../../stores/useToastStore';

const mocks = vi.hoisted(() => ({
  projectDescription: null as string | null,
  updateTodo: vi.fn(),
  deleteTodo: vi.fn(),
  toggleTodo: vi.fn(),
  persist: vi.fn(),
  projectPath: '/Users/test/papers' as string | null,
  hostLabel: 'My Mac' as string | null,
  projectError: false,
  canRun: false,
  runTask: vi.fn(),
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
  assignee: null as string | null,
  enabled_skills: null as string[] | null,
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
  useTaskExecutionTelemetryQuery: () => ({ data: [] }),
  useRunReadyTaskWithProjectDefaults: () => ({
    runTask: mocks.runTask,
    canRunTask: () => mocks.canRun,
    isPending: false,
  }),
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
vi.mock('../../components/task-flow/TaskFlow', () => ({
  default: ({ rootId }: { rootId: string }) => <div>Flow for {rootId}</div>,
}));
vi.mock('../../components/task-detail/TaskPaths', () => ({ default: () => null }));
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
    task.enabled_skills = null;
    task.assignee = null;
    mocks.projectPath = '/Users/test/papers';
    mocks.hostLabel = 'My Mac';
    mocks.projectError = false;
    mocks.canRun = false;
    mocks.runTask.mockReset();
    useToastStore.setState({ toasts: [] });
  });

  it('shows the original-document action from the project description first line', () => {
    mocks.projectDescription = '/home/research/E65.md\nAdditional project context';

    renderPage();

    expect(screen.getByRole('button', { name: 'Open original document' })).toBeVisible();
  });

  it('does not use a task description path when the project has no canonical document', () => {
    renderPage();

    expect(
      screen.queryByRole('button', { name: 'Open original document' }),
    ).not.toBeInTheDocument();
  });

  it('leads a task you do yourself with its due date, project and flow', () => {
    renderPage();

    expect(screen.getByLabelText('Due')).toBeVisible();
    expect(screen.getByRole('link', { name: 'P0-R Semantic referent binding' })).toHaveAttribute(
      'href',
      '/projects/project-p0-r',
    );
    expect(screen.getByText('Flow for todo-e65a')).toBeVisible();
    expect(screen.getByPlaceholderText('Add a description...')).toBeVisible();
    // No five steps, no plan button, no machine line for work not handed to an agent.
    expect(document.querySelector('.cc-stage-dots')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Suggest steps' })).not.toBeInTheDocument();
    expect(screen.queryByText('Runs on My Mac')).not.toBeInTheDocument();
  });

  it('keeps the other actions in the menu', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));

    expect(screen.getByRole('menuitem', { name: 'Discuss with agent' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Suggest steps' })).toBeVisible();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Task' }));
    expect(mocks.deleteTodo).toHaveBeenCalledWith('todo-e65a');
  });

  it('delegates from the menu by setting the assignee', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delegate' }));

    expect(mocks.updateTodo).toHaveBeenCalledWith({
      id: 'todo-e65a',
      data: { assignee: 'agent' },
    });
  });

  it('says where delegated work runs, with Change and Undo', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delegate' }));

    const [toast] = useToastStore.getState().toasts;
    expect(toast.message).toBe('Delegated to AI · Runs on My Mac');
    expect(toast.action?.label).toBe('Change');
    expect(toast.secondaryAction?.label).toBe('Undo');
  });

  it('offers to start delegated work as it stands, with suggesting steps beside it', () => {
    task.assignee = 'agent';
    mocks.canRun = true;
    renderPage();

    const start = screen.getByRole('button', { name: 'Start as is' });
    expect(start).toHaveClass('cc-btn--primary');
    expect(screen.getByRole('button', { name: 'Suggest steps' })).toHaveClass('cc-btn--ghost');
    fireEvent.click(start);
    expect(mocks.runTask).toHaveBeenCalledWith('todo-e65a');
  });

  it('treats a task with an assignee as delegated', () => {
    task.assignee = 'agent';
    renderPage();

    expect(document.querySelector('.cc-stage-dots')).not.toBeNull();
    expect(document.querySelector('.cc-stage-bar')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menuitem', { name: 'Do it myself' })).toBeVisible();
  });

  it('opens where this runs from the menu and resets it when switching tasks', () => {
    renderPage();
    expect(screen.queryByText('Workspace editor: project-p0-r')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Where this runs' }));
    expect(screen.getByRole('dialog', { name: 'Where this runs' })).toBeInTheDocument();
    expect(screen.getByText('Workspace editor: project-p0-r')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('link', { name: 'Other task' }));
    expect(screen.getByText('Flow for other-task')).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'Where this runs' })).not.toBeInTheDocument();
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it('shows the five steps, plan button and machine for a task handed to an agent', () => {
    task.enabled_skills = ['research'];
    renderPage();

    expect(document.querySelector('.cc-stage-dots')).not.toBeNull();
    expect(document.querySelector('.cc-stage-bar')).toBeNull();
    expect(screen.getByRole('button', { name: 'Suggest steps' })).toBeVisible();
    expect(screen.getByText('Runs on My Mac')).toBeVisible();
    expect(screen.getByText('/Users/test/papers')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Change where this runs' }));
    expect(screen.getByRole('dialog', { name: 'Where this runs' })).toBeInTheDocument();
  });

  it('shows a missing machine explicitly for an agent task', () => {
    task.enabled_skills = ['research'];
    mocks.projectPath = null;
    mocks.hostLabel = null;
    renderPage();
    expect(screen.getByText('Not set up')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Choose machine' }));
    expect(screen.getByRole('dialog', { name: 'Where this runs' })).toBeInTheDocument();
  });

  it('does not present a failed project lookup as an unset workspace', () => {
    task.enabled_skills = ['research'];
    mocks.projectError = true;
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent('This project could not be loaded.');
    expect(screen.queryByText('Not set up')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose machine' })).not.toBeInTheDocument();
  });

  it('keeps the agent thread and offers no recurrence even for a legacy recurring task', () => {
    task.recurrence_rule = 'RRULE:FREQ=WEEKLY';
    renderPage();
    expect(screen.getByText('Agent thread')).toBeVisible();
    expect(screen.queryByText('Repeat')).not.toBeInTheDocument();
    expect(screen.queryByText(/^Skills/)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Task title')).toBeVisible();
  });

  it('renders its menu into a host slot, with the host entries first', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const slot = document.createElement('span');
    document.body.appendChild(slot);
    const onSelect = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <TaskDetail
            taskId="todo-e65a"
            menuSlot={slot}
            extraMenuItems={[{ label: 'Open as page', onSelect }]}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const trigger = within(slot).getByRole('button', { name: 'More actions' });
    fireEvent.click(trigger);
    const items = within(slot)
      .getAllByRole('menuitem')
      .map((item) => item.textContent);
    expect(items[0]).toBe('Open as page');
    expect(items).toContain('Delete Task');
    fireEvent.click(within(slot).getByRole('menuitem', { name: 'Open as page' }));
    expect(onSelect).toHaveBeenCalled();
    slot.remove();
  });
});
