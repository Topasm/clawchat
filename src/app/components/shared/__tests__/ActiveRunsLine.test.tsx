import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentRunResponse } from '../../../types/api';
import { useRunNoticeStore } from '../../../stores/useRunNoticeStore';
import ActiveRunsLine from '../ActiveRunsLine';

const mocks = vi.hoisted(() => ({
  active: vi.fn(),
  awaiting: vi.fn(),
  navigate: vi.fn(),
  openRunThread: vi.fn(),
}));

vi.mock('../../../hooks/queries', () => ({
  useActiveRunsQuery: mocks.active,
  useRunsAwaitingInputQuery: mocks.awaiting,
}));
vi.mock('../../../hooks/useOpenRunThread', () => ({ default: () => mocks.openRunThread }));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mocks.navigate };
});

function run(overrides: Partial<AgentRunResponse>): AgentRunResponse {
  return {
    id: 'run-1',
    todo_title: 'Profile the GPU kernel',
    instruction: 'Profile the GPU kernel',
    status: 'running',
    host_label: 'Home',
    created_at: new Date(Date.now() - 3 * 60_000).toISOString(),
    ...overrides,
  } as AgentRunResponse;
}

function renderLine() {
  return render(
    <MemoryRouter>
      <ActiveRunsLine />
    </MemoryRouter>,
  );
}

describe('ActiveRunsLine', () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.openRunThread.mockReset();
    mocks.active.mockReturnValue({ data: [] });
    mocks.awaiting.mockReturnValue({ data: [] });
    useRunNoticeStore.setState({ failed: [] });
  });

  it('shows nothing while nothing runs', () => {
    renderLine();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('counts the one run, says what it is on hover, and opens its thread', () => {
    mocks.active.mockReturnValue({ data: [run({})] });
    renderLine();
    const line = screen.getByRole('button', { name: '1 running' });
    expect(line).toHaveAttribute('title', 'Profile the GPU kernel · Home · 3m ago');
    fireEvent.click(line);
    expect(mocks.openRunThread).toHaveBeenCalledWith('run-1', 'Profile the GPU kernel');
  });

  it('counts several runs and, without a panel, opens the run list', () => {
    mocks.active.mockReturnValue({ data: [run({}), run({ id: 'run-2' })] });
    renderLine();
    fireEvent.click(screen.getByRole('button', { name: '2 running' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/attention?view=runs');
  });

  it('turns into the question when a run is waiting on an answer', () => {
    mocks.active.mockReturnValue({ data: [run({})] });
    mocks.awaiting.mockReturnValue({
      data: [run({ id: 'run-3', status: 'waiting_input', todo_title: 'Pick a venue' })],
    });
    renderLine();
    const line = screen.getByRole('button', { name: 'Needs an answer' });
    expect(line).toHaveClass('cc-active-runs--needs-answer');
    fireEvent.click(line);
    expect(mocks.openRunThread).toHaveBeenCalledWith('run-3', 'Pick a venue');
  });

  it('names a failure until it has been opened once', () => {
    act(() => useRunNoticeStore.getState().noteFailed('run-9', 'Sync the vault'));
    renderLine();
    const line = screen.getByRole('button', { name: '1 failed' });
    expect(line).toHaveClass('cc-active-runs--failed');
    fireEvent.click(line);
    expect(mocks.openRunThread).toHaveBeenCalledWith('run-9', 'Sync the vault');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('says Done for a moment once the last run finishes', () => {
    vi.useFakeTimers();
    try {
      mocks.active.mockReturnValue({ data: [run({})] });
      const { rerender } = renderLine();
      mocks.active.mockReturnValue({ data: [] });
      rerender(
        <MemoryRouter>
          <ActiveRunsLine />
        </MemoryRouter>,
      );
      expect(screen.getByText('Done')).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(3100);
      });
      expect(screen.queryByText('Done')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
