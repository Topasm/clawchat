import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProjectWorkspacePage from '../ProjectWorkspacePage';

const mocks = vi.hoisted(() => ({
  openPanel: vi.fn(),
  resetPanel: vi.fn(),
  setPanelPresentation: vi.fn(),
  getConversation: vi.fn(),
  updateProject: vi.fn(),
  planTodos: [] as Array<Record<string, unknown>>,
}));

const project = {
  id: 'project-1',
  title: 'ClawChat improvements',
  goal: 'Connect planning and execution',
  description: null as string | null,
  execution_instructions: null,
  status: 'active',
  deadline: null,
  root_task_id: 'todo-root',
  graph_revision: 3,
  default_execution_provider: 'builtin',
  default_execution_model: null,
  execution_workspace_path: null,
  execution_workspace_isolation: 'local',
  execution_base_branch: null,
  created_at: '2026-09-04T00:00:00Z',
  updated_at: '2026-09-04T00:00:00Z',
  task_count: 1,
  completed_task_count: 0,
  conversation_id: null,
  ready_count: 1,
  blocked_count: 0,
  at_risk_count: 0,
  running_agent_count: 0,
  pending_review_count: 0,
  critical_path_minutes: 30,
};

vi.mock('../../hooks/queries', () => ({
  useProjectQuery: () => ({ data: project, isLoading: false, isError: false }),
  useTodosQuery: () => ({
    data: [
      { id: 'todo-root', title: project.title, project_id: project.id, source: 'project_root' },
      { id: 'todo-task', title: 'Agent panel', project_id: project.id, parent_id: 'todo-root' },
    ],
  }),
  useGetOrCreateProjectConversation: () => ({
    mutateAsync: mocks.getConversation,
    isPending: false,
  }),
  useDeleteProject: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateProject: () => ({ mutate: mocks.updateProject, isPending: false }),
  useExecutionProvidersQuery: () => ({ data: [], isLoading: false }),
  useTestPaseoConnection: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../../hooks/usePlatform', () => ({ default: () => ({ isMobile: false }) }));
vi.mock('../../components/chat-panel/ChatPanelControllerContext', () => ({
  useChatPanelController: () => ({
    open: mocks.openPanel,
    reset: mocks.resetPanel,
    presentation: { kind: 'quick', title: 'Quick Chat' },
    setPresentation: mocks.setPanelPresentation,
  }),
}));
vi.mock('../../components/projects/ProjectPlan', () => ({
  default: ({ todos }: { todos: Array<Record<string, unknown>> }) => {
    mocks.planTodos = todos;
    return <div>Project plan content</div>;
  },
}));
vi.mock('../../components/projects/ProjectActivity', () => ({
  default: () => <div>Project activity content</div>,
}));
vi.mock('../../components/projects/ProjectArtifacts', () => ({
  default: () => <div>Project files content</div>,
}));
vi.mock('../../components/shared/ProjectWorkspaceHosts', () => ({
  default: () => <div>Workspace settings</div>,
}));

function renderPage() {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={['/projects/project-1']}>
        <Routes>
          <Route path="/projects/:projectId" element={<ProjectWorkspacePage />} />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  );
}

describe('ProjectWorkspacePage', () => {
  beforeEach(() => {
    mocks.openPanel.mockReset();
    mocks.resetPanel.mockReset();
    mocks.setPanelPresentation.mockReset();
    mocks.getConversation.mockReset().mockResolvedValue({ id: 'conv-project' });
    mocks.updateProject.mockReset();
    mocks.planTodos = [];
    project.description = null;
  });

  it('opens Project Agent in the shared panel and keeps the root out of the plan', async () => {
    renderPage();

    expect(screen.getByText('Project plan content')).toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.openPanel).toHaveBeenCalledWith('conv-project', {
        kind: 'project',
        title: 'Project Agent',
        subtitle: project.title,
      }),
    );
    expect(mocks.openPanel).toHaveBeenCalledTimes(1);
    expect(mocks.planTodos.map((todo) => todo.id)).toEqual(['todo-task']);
  });

  it('uses only Plan, Activity and Files as workspace sections', () => {
    renderPage();

    expect(screen.queryByRole('button', { name: 'Overview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Runs' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Activity' }));
    expect(screen.getByText('Project activity content')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Files' }));
    expect(screen.getByText('Project files content')).toBeInTheDocument();
  });

  it('shows the canonical document button only for a supported first description line', () => {
    const { unmount } = renderPage();
    expect(
      screen.queryByRole('button', { name: 'Open original document' }),
    ).not.toBeInTheDocument();
    unmount();

    project.description = '/home/research/E65.md\nAdditional context';
    renderPage();

    expect(screen.getByRole('button', { name: 'Open original document' })).toBeInTheDocument();
  });

  it('jumps from the header machine line to the folded "Where this runs" section', () => {
    const { container } = renderPage();
    const details = container.querySelector<HTMLDetailsElement>(
      'details.cc-project-settings-disclosure',
    );
    expect(details?.open).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Choose machine' }));

    expect(details?.open).toBe(true);
  });

  it('saves project-wide agent execution rules', () => {
    renderPage();

    fireEvent.change(screen.getByLabelText('Agent execution rules'), {
      target: { value: 'Never use --force.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save execution settings' }));

    expect(mocks.updateProject).toHaveBeenCalledWith(
      expect.objectContaining({ execution_instructions: 'Never use --force.' }),
    );
  });
});
