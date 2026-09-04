import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ChatPage from '../ChatPage';

const mocks = vi.hoisted(() => ({
  resume: vi.fn(),
  todos: [] as Array<Record<string, unknown>>,
  conversations: [] as Array<Record<string, unknown>>,
  projects: [] as Array<Record<string, unknown>>,
  runs: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../hooks/queries', () => ({
  useTodosQuery: () => ({ data: mocks.todos }),
  useMessagesQuery: () => ({
    data: [],
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
  }),
  useConversationsQuery: () => ({ data: mocks.conversations }),
  useProjectsQuery: () => ({ data: mocks.projects }),
  useDeleteMessage: () => ({ mutate: vi.fn() }),
  useRegenerateMessage: () => ({ mutateAsync: vi.fn() }),
  useResumeAgentRun: () => ({ mutateAsync: mocks.resume }),
  useRunsAwaitingInputQuery: () => ({ data: mocks.runs }),
}));

describe('ChatPage agent answer mode', () => {
  beforeEach(() => {
    mocks.resume.mockReset().mockResolvedValue({});
    mocks.todos = [];
    mocks.projects = [];
    mocks.conversations = [
      {
        id: 'conv-1',
        title: 'Agent thread',
        created_at: '2026-09-04T00:00:00Z',
        updated_at: '2026-09-04T00:00:00Z',
      },
    ];
    mocks.runs = [{ id: 'run-1', status: 'waiting_input', conversation_id: 'conv-1' }];
  });

  it('sends the composer text as a run follow-up for a waiting thread', async () => {
    render(
      <MemoryRouter initialEntries={['/chats/conv-1']}>
        <Routes>
          <Route path="/chats/:conversationId" element={<ChatPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Answering the agent')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Answer the agent...'), {
      target: { value: 'Use the concise option' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() =>
      expect(mocks.resume).toHaveBeenCalledWith({
        runId: 'run-1',
        followUp: 'Use the concise option',
      }),
    );
  });

  it('shows both project and task scope and returns to the project', () => {
    mocks.projects = [
      {
        id: 'project-1',
        title: 'ClawChat improvements',
        root_task_id: 'todo-root',
        task_count: 1,
        completed_task_count: 0,
      },
    ];
    mocks.todos = [{ id: 'todo-task', title: 'Project Agent panel' }];
    mocks.conversations = [
      {
        id: 'conv-1',
        title: 'Project Agent panel',
        project_id: 'project-1',
        project_todo_id: 'todo-task',
      },
    ];
    mocks.runs = [];

    render(
      <MemoryRouter initialEntries={['/chats/conv-1']}>
        <Routes>
          <Route path="/chats/:conversationId" element={<ChatPage />} />
          <Route path="/projects/:projectId" element={<div>Project workspace</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('ClawChat improvements')).toBeInTheDocument();
    expect(screen.getByText('Task thread')).toBeInTheDocument();
    expect(screen.getAllByText('Project Agent panel').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Back to project' }));
    expect(screen.getByText('Project workspace')).toBeInTheDocument();
  });

  it('uses run metadata to recover the task scope of a root-scoped run thread', () => {
    mocks.projects = [
      {
        id: 'project-1',
        title: 'ClawChat improvements',
        root_task_id: 'todo-root',
        task_count: 1,
        completed_task_count: 0,
      },
    ];
    mocks.todos = [{ id: 'todo-task', title: 'Mobile panel' }];
    mocks.conversations = [
      {
        id: 'conv-1',
        title: 'Mobile panel',
        project_id: 'project-1',
        project_todo_id: 'todo-root',
        metadata: { origin: 'agent_run', todo_id: 'todo-task' },
      },
    ];
    mocks.runs = [];

    render(
      <MemoryRouter initialEntries={['/chats/conv-1']}>
        <Routes>
          <Route path="/chats/:conversationId" element={<ChatPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Task thread')).toBeInTheDocument();
    expect(screen.getAllByText('Mobile panel').length).toBeGreaterThan(0);
  });
});
