import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProjectWorkspacePage from '../ProjectWorkspacePage';
import { useChatStore } from '../../stores/useChatStore';

const mocks = vi.hoisted(() => ({
  openPanel: vi.fn(),
  resetPanel: vi.fn(),
  setPanelPresentation: vi.fn(),
  getConversation: vi.fn(),
  updateProject: vi.fn(),
  get: vi.fn(),
  setConversationId: vi.fn(),
  isMobile: false,
  planTodos: [] as Array<Record<string, unknown>>,
}));
vi.mock('../../services/apiClient', () => ({ default: { get: mocks.get } }));

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
  useTestExecutionProvider: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../../hooks/usePlatform', () => ({ default: () => ({ isMobile: mocks.isMobile }) }));
vi.mock('../../components/chat-panel/ChatPanelControllerContext', () => ({
  useChatPanelController: () => ({
    open: mocks.openPanel,
    reset: mocks.resetPanel,
    presentation: { kind: 'quick', title: 'Quick Chat' },
    setPresentation: mocks.setPanelPresentation,
    setConversationId: mocks.setConversationId,
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
    useChatStore.setState({ activeConversationByProject: {} });
    mocks.get.mockReset();
    mocks.isMobile = false;
    mocks.setConversationId.mockReset();
    mocks.openPanel.mockReset();
    mocks.resetPanel.mockReset();
    mocks.setPanelPresentation.mockReset();
    mocks.getConversation.mockReset().mockResolvedValue({ id: 'conv-project' });
    mocks.updateProject.mockReset();
    mocks.planTodos = [];
    project.description = null;
  });

  it('opens Project Agent only when asked and keeps the root out of the plan', async () => {
    renderPage();

    expect(screen.getByText('Project plan content')).toBeInTheDocument();
    expect(mocks.planTodos.map((todo) => todo.id)).toEqual(['todo-task']);
    await waitFor(() => expect(mocks.get).not.toHaveBeenCalled());
    expect(mocks.openPanel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Project Agent' }));
    await waitFor(() =>
      expect(mocks.openPanel).toHaveBeenCalledWith('conv-project', {
        projectId: project.id,
        kind: 'project',
        title: 'Project Agent',
        subtitle: project.title,
      }),
    );
    expect(mocks.openPanel).toHaveBeenCalledTimes(1);
  });

  it('restores the remembered run instead of creating a project conversation', async () => {
    useChatStore.getState().rememberProjectConversation(project.id, 'run-thread', 'run');
    mocks.get.mockResolvedValue({
      data: {
        id: 'run-thread',
        project_id: project.id,
        created_at: '2026-09-05T00:00:00Z',
        updated_at: '2026-09-05T00:00:00Z',
      },
    });
    renderPage();
    await waitFor(() =>
      expect(mocks.openPanel).toHaveBeenCalledWith('run-thread', {
        projectId: project.id,
        kind: 'run',
        title: 'Task Agent',
        subtitle: project.title,
      }),
    );
    expect(mocks.getConversation).not.toHaveBeenCalled();
    expect(mocks.openPanel).toHaveBeenCalledTimes(1);
  });

  it('restores mobile selection without opening the panel', async () => {
    mocks.isMobile = true;
    useChatStore.getState().rememberProjectConversation(project.id, 'run-mobile', 'run');
    mocks.get.mockResolvedValue({
      data: {
        id: 'run-mobile',
        project_id: project.id,
        created_at: '2026-09-05T00:00:00Z',
        updated_at: '2026-09-05T00:00:00Z',
      },
    });
    renderPage();
    await waitFor(() => expect(mocks.setConversationId).toHaveBeenCalledWith('run-mobile'));
    expect(mocks.openPanel).not.toHaveBeenCalled();
    expect(mocks.setPanelPresentation).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'run' }),
    );
  });

  it('keeps the last run on a transient connection failure', async () => {
    useChatStore.getState().rememberProjectConversation(project.id, 'run-offline', 'run');
    mocks.get.mockRejectedValue({ response: { status: 503 } });
    renderPage();
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    expect(mocks.getConversation).not.toHaveBeenCalled();
    expect(Object.values(useChatStore.getState().activeConversationByProject)).toContainEqual({
      conversationId: 'run-offline',
      kind: 'run',
    });
  });

  it('forgets a remembered conversation that belongs elsewhere instead of opening it', async () => {
    useChatStore.getState().rememberProjectConversation(project.id, 'foreign-thread', 'run');
    mocks.get.mockResolvedValue({
      data: {
        id: 'foreign-thread',
        project_id: 'another-project',
        created_at: '2026-09-05T00:00:00Z',
        updated_at: '2026-09-05T00:00:00Z',
      },
    });
    renderPage();
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    await waitFor(() =>
      expect(Object.values(useChatStore.getState().activeConversationByProject)).not.toContainEqual(
        { conversationId: 'foreign-thread', kind: 'run' },
      ),
    );
    expect(mocks.openPanel).not.toHaveBeenCalled();
    expect(mocks.getConversation).not.toHaveBeenCalled();
  });

  it('uses only Plan, Activity and Files as workspace sections', () => {
    renderPage();

    expect(screen.queryByRole('button', { name: 'Overview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Runs' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Notes' })).not.toBeInTheDocument();
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

  it('opens the one workspace editor as a dialog from the machine line', () => {
    renderPage();
    expect(screen.queryByText('Workspace settings')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Choose machine' }));

    expect(screen.getByRole('dialog', { name: 'Execution settings' })).toBeInTheDocument();
    expect(screen.getAllByText('Workspace settings')).toHaveLength(1);
  });

  it.each(['Activity', 'Files'])('edits the workspace without leaving the %s tab', (tab) => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: tab }));
    const content = screen.getByText(
      tab === 'Files' ? 'Project files content' : 'Project activity content',
    );
    expect(content).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Choose machine' }));
    expect(screen.getByText('Workspace settings')).toBeVisible();
    expect(content).toBeInTheDocument();
    expect(screen.queryByText('Project plan content')).not.toBeInTheDocument();
  });

  it('saves project-wide agent execution rules', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Execution settings' }));

    fireEvent.change(screen.getByLabelText('Agent execution rules'), {
      target: { value: 'Never use --force.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save execution settings' }));

    expect(mocks.updateProject).toHaveBeenCalledWith(
      expect.objectContaining({ execution_instructions: 'Never use --force.' }),
    );
  });
});
