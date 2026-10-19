import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import TaskAgentThreadSection, { runElapsedLabel } from '../TaskAgentThreadSection';

const mocks = vi.hoisted(() => ({
  runs: [] as unknown[],
  events: [] as unknown[],
  cancel: vi.fn(),
}));

vi.mock('../../../hooks/queries', () => ({
  useAgentRunsQuery: () => ({ data: mocks.runs }),
  useAgentRunEventsQuery: () => ({ data: mocks.events }),
  useCancelAgentRun: () => ({ mutate: mocks.cancel, isPending: false }),
  useRetryAgentRun: () => ({ mutate: vi.fn(), isPending: false }),
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
        status: 'completed',
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

  it('draws a working run as a live card with its last steps, Stop and the run log', () => {
    mocks.events = [
      { id: 'e1', event_type: 'running', message: 'Execution started' },
      { id: 'e2', event_type: 'tool_call', message: 'read profile.csv' },
      { id: 'e3', event_type: 'tool_call', message: 'writing fig1_latency.png' },
    ];
    mocks.runs = [
      {
        id: 'run-live',
        todo_id: 'task-1',
        provider: 'codex_cli',
        status: 'running',
        host_label: 'MacBook',
        started_at: new Date(Date.now() - 2 * 60_000).toISOString(),
        created_at: '2026-10-02T00:00:00Z',
        conversation_id: 'conv-1',
      },
    ];
    renderSection();
    expect(screen.getByText(/2 min in · MacBook/)).toBeInTheDocument();
    expect(screen.getByText('read profile.csv')).toBeInTheDocument();
    expect(screen.queryByText('Execution started')).not.toBeInTheDocument();
    screen.getByRole('button', { name: 'Stop run' }).click();
    expect(mocks.cancel).toHaveBeenCalledWith('run-live');
    expect(screen.getByRole('button', { name: 'Full run log' })).toBeInTheDocument();
  });

  it('says how long a run has been going', () => {
    const now = Date.parse('2026-10-18T10:00:00Z');
    expect(runElapsedLabel(null, now)).toBe('Waiting to start');
    expect(runElapsedLabel('2026-10-18T09:59:30Z', now)).toBe('Just started');
    expect(runElapsedLabel('2026-10-18T09:57:00Z', now)).toBe('3 min in');
  });
});
