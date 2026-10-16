import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentRunResponse } from '../../../types/api';
import ActiveRunsLine from '../ActiveRunsLine';

const mocks = vi.hoisted(() => ({
  active: vi.fn(),
  awaiting: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('../../../hooks/queries', () => ({
  useActiveRunsQuery: mocks.active,
  useRunsAwaitingInputQuery: mocks.awaiting,
}));
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
    ...overrides,
  } as AgentRunResponse;
}

describe('ActiveRunsLine', () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.active.mockReturnValue({ data: [] });
    mocks.awaiting.mockReturnValue({ data: [] });
  });

  it('shows nothing while nothing runs', () => {
    const { container } = render(
      <MemoryRouter>
        <ActiveRunsLine />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('names the one run and opens it on the Attention page', () => {
    mocks.active.mockReturnValue({ data: [run({})] });
    render(
      <MemoryRouter>
        <ActiveRunsLine />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Running · Profile the GPU kernel' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/attention?view=runs&run_id=run-1');
  });

  it('counts several runs and opens the run list', () => {
    mocks.active.mockReturnValue({ data: [run({}), run({ id: 'run-2' })] });
    render(
      <MemoryRouter>
        <ActiveRunsLine />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: '2 running' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/attention?view=runs');
  });

  it('turns into the question when a run is waiting on an answer', () => {
    mocks.active.mockReturnValue({ data: [run({})] });
    mocks.awaiting.mockReturnValue({
      data: [run({ id: 'run-3', status: 'waiting_input', todo_title: 'Pick a venue' })],
    });
    render(
      <MemoryRouter>
        <ActiveRunsLine />
      </MemoryRouter>,
    );
    const line = screen.getByRole('button', { name: 'Needs an answer · Pick a venue' });
    expect(line).toHaveClass('cc-active-runs--needs-answer');
    fireEvent.click(line);
    expect(mocks.navigate).toHaveBeenCalledWith('/attention');
  });
});
