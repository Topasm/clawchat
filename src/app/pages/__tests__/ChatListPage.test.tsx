import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import ChatListPage from '../ChatListPage';

const project = {
  id: 'project-1',
  title: 'ClawChat improvements',
  goal: 'Connect the workflow',
  status: 'active',
  root_task_id: 'todo-root',
  graph_revision: 1,
  execution_workspace_isolation: 'local',
  created_at: '2026-09-04T00:00:00Z',
  updated_at: '2026-09-04T00:00:00Z',
  task_count: 1,
  completed_task_count: 0,
};

const mocks = vi.hoisted(() => ({ createProject: vi.fn() }));

vi.mock('../../hooks/queries', () => ({
  queryKeys: { inboxProjectCandidates: ['inbox-project-candidates'] },
  useInboxProjectCandidatesQuery: () => ({
    data: [
      {
        name: 'iclr_2027',
        folder: '01_Projects/iclr_2027',
        source_name: 'workspace',
        has_todo: true,
      },
    ],
  }),
  useConversationsQuery: () => ({
    data: [
      {
        id: 'conv-project',
        title: 'Project-only thread',
        project_id: project.id,
        project_todo_id: project.root_task_id,
        created_at: '2026-09-04T00:00:00Z',
        updated_at: '2026-09-04T00:00:00Z',
      },
      {
        id: 'conv-quick',
        title: 'Outside question',
        created_at: '2026-09-04T00:00:00Z',
        updated_at: '2026-09-04T00:00:00Z',
      },
    ],
    isLoading: false,
  }),
  useProjectsQuery: () => ({ data: [project], isLoading: false }),
  useTodosQuery: () => ({
    data: [
      { id: 'todo-root', project_id: project.id, source: 'project_root' },
      { id: 'todo-task', project_id: project.id, parent_id: 'todo-root' },
    ],
  }),
  useCreateConversation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateProject: () => ({
    mutate: mocks.createProject,
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useExecutionHostsQuery: () => ({ data: [], isLoading: false }),
  useRegisterWorkerHost: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useBindProjectWorkspace: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteProject: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteConversation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../../hooks/usePlatform', () => ({ default: () => ({ isMobile: false }) }));

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/projects']}>
        <Routes>
          <Route path="/projects" element={<ChatListPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ChatListPage scopes', () => {
  it('lists projects first and the chats outside them below, never a project thread', () => {
    renderPage();

    expect(screen.getByText(project.title)).toBeInTheDocument();
    expect(screen.getByText('Outside question')).toBeInTheDocument();
    expect(screen.queryByText('Project-only thread')).not.toBeInTheDocument();
  });

  it('has no quick chat button of its own', () => {
    renderPage();
    expect(screen.queryByRole('button', { name: '+ Quick Chat' })).toBeNull();
  });

  it('offers vault project folders and imports one only when asked', () => {
    renderPage();
    const panel = screen.getByRole('region', { name: 'Projects in your vault' });
    expect(mocks.createProject).not.toHaveBeenCalled();
    fireEvent.click(within(panel).getByRole('button', { name: 'Import' }));
    expect(mocks.createProject).toHaveBeenCalledWith(
      { title: 'iclr_2027', description: '01_Projects/iclr_2027' },
      expect.any(Object),
    );
  });
});
