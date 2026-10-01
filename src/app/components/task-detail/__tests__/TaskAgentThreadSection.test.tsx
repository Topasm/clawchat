import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import TaskAgentThreadSection from '../TaskAgentThreadSection';

const mocks = vi.hoisted(() => ({ runs: [] as unknown[] }));

vi.mock('../../../hooks/queries', () => ({
  useAgentRunsQuery: () => ({ data: mocks.runs }),
}));

function renderSection() {
  return render(
    <MemoryRouter>
      <TaskAgentThreadSection taskId="task-1" />
    </MemoryRouter>,
  );
}

describe('TaskAgentThreadSection', () => {
  it('renders nothing for a task that has never run', () => {
    mocks.runs = [];
    renderSection();
    expect(screen.queryByTestId('task-agent-thread')).not.toBeInTheDocument();
  });

  it('shows the latest run with its thread and run links', () => {
    mocks.runs = [
      {
        id: 'run-old',
        todo_id: 'task-1',
        status: 'failed',
        created_at: '2026-10-01T00:00:00Z',
        conversation_id: null,
      },
      {
        id: 'run-new',
        todo_id: 'task-1',
        status: 'running',
        created_at: '2026-10-02T00:00:00Z',
        conversation_id: 'conv-1',
      },
      {
        id: 'run-other',
        todo_id: 'task-2',
        status: 'completed',
        created_at: '2026-10-03T00:00:00Z',
        conversation_id: null,
      },
    ];
    renderSection();
    expect(screen.getByTestId('task-agent-thread')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open thread' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open run' })).toBeInTheDocument();
  });
});
