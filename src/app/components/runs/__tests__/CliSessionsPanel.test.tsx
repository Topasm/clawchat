import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CliSessionsPanel from '../CliSessionsPanel';
import type { CliSession } from '../../../hooks/queries/useCliSessionQueries';

const mocks = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn(), mutate: vi.fn() }));
vi.mock('../../../hooks/queries/useCliSessionQueries', () => ({
  useCliSessionsQuery: mocks.list,
  useCliSessionDetailQuery: mocks.detail,
  useCliSessionAction: () => ({ mutate: mocks.mutate, isPending: false }),
}));

const codex: CliSession = {
  id: 'same-id',
  provider: 'codex',
  title: 'Fix pipeline',
  cwd: '/work/project',
  status: 'running',
  kind: 'interactive',
  updated_at: 1,
  waiting_for: null,
  can_send: true,
  can_stop: true,
  can_restart: false,
  can_read: true,
  resume_command: 'codex resume same-id',
};
const claude: CliSession = {
  ...codex,
  provider: 'claude',
  title: 'Check report',
  can_send: false,
  can_stop: false,
  can_read: false,
  resume_command: 'claude --resume same-id',
};

describe('external CLI sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockReturnValue({
      data: { sessions: [codex, claude], providers: [] },
      refetch: vi.fn(),
    });
    mocks.detail.mockImplementation((session) => ({ data: { session, output: '' } }));
  });

  it('shows both providers and keeps their session identities separate', () => {
    render(<CliSessionsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Fix pipeline/ }));
    expect(screen.getByRole('button', { name: 'Stop session' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Check report/ }));
    expect(screen.queryByRole('button', { name: 'Stop session' })).not.toBeInTheDocument();
    expect(screen.getByText(/original terminal/)).toBeInTheDocument();
  });

  it('sends a follow-up to the selected provider and session', () => {
    render(<CliSessionsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Fix pipeline/ }));
    fireEvent.change(screen.getByLabelText('Follow-up instruction'), {
      target: { value: 'Check tests' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send to session' }));
    expect(mocks.mutate).toHaveBeenCalledWith(
      { session: codex, action: 'message', message: 'Check tests' },
      expect.any(Object),
    );
  });

  it('keeps history distinct from live sessions and filters by provider', () => {
    mocks.list.mockReturnValue({
      data: {
        sessions: [
          claude,
          { ...codex, kind: 'history', status: 'unknown', can_send: false, can_stop: false },
        ],
        providers: [],
      },
    });
    render(<CliSessionsPanel />);
    expect(screen.queryByText('Fix pipeline')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Show saved sessions'));
    expect(screen.getByText('Fix pipeline')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('CLI provider'), { target: { value: 'codex' } });
    expect(screen.queryByText('Check report')).not.toBeInTheDocument();
    expect(screen.getByText('Saved session')).toBeInTheDocument();
  });

  it('shows connection failures without claiming an empty list', () => {
    mocks.list.mockReturnValue({ isError: true, refetch: vi.fn() });
    render(<CliSessionsPanel />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load CLI sessions');
    expect(screen.queryByText('No CLI sessions match this view.')).not.toBeInTheDocument();
  });
});
