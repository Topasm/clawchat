import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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

vi.mock('../../hooks/queries', () => ({
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
  useCreateProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useExecutionHostsQuery: () => ({ data: [], isLoading: false }),
  useRegisterWorkerHost: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useBindProjectWorkspace: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteProject: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteConversation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../../hooks/usePlatform', () => ({ default: () => ({ isMobile: false }) }));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/projects" element={<ChatListPage />} />
        <Route path="/chats" element={<ChatListPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ChatListPage scopes', () => {
  it('shows only project cards on the Projects route', () => {
    renderAt('/projects');

    expect(screen.getByText(project.title)).toBeInTheDocument();
    expect(screen.queryByText('Project-only thread')).not.toBeInTheDocument();
    expect(screen.queryByText('Outside question')).not.toBeInTheDocument();
  });

  it('keeps project threads out of the global Chats route', () => {
    renderAt('/chats');

    expect(screen.getByText('Outside question')).toBeInTheDocument();
    expect(screen.queryByText('Project-only thread')).not.toBeInTheDocument();
    expect(screen.queryByText(project.title)).not.toBeInTheDocument();
  });
});
