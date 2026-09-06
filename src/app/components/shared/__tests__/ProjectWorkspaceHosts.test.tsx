import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkerStore } from '../../../stores/useWorkerStore';
import ProjectWorkspaceHosts from '../ProjectWorkspaceHosts';

const apiMocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), delete: vi.fn() }));
const native = vi.hoisted(() => ({
  isDesktop: false,
  selectFolder: vi.fn(),
  readContext: vi.fn(),
}));
vi.mock('../../../hooks/usePlatform', () => ({ default: () => ({ isDesktop: native.isDesktop }) }));
vi.mock('../../../platform', () => ({
  platformApi: {
    server: { selectFolder: native.selectFolder },
    worker: { readContext: native.readContext },
  },
}));

vi.mock('../../../services/apiClient', () => ({
  default: { get: apiMocks.get, put: apiMocks.put, delete: apiMocks.delete },
}));
vi.mock('../../../stores/useAuthStore', () => ({
  useAuthStore: (selector: (state: { serverUrl: string }) => unknown) =>
    selector({ serverUrl: 'https://server' }),
}));

const hosts = [
  { id: 'host-ubuntu', label: 'Workstation', kind: 'local', is_enabled: true },
  { id: 'host-mac', label: 'MacBook', kind: 'worker', is_enabled: true },
];

function mockWorkspace(workspace: Record<string, unknown>) {
  apiMocks.get.mockImplementation(async (url: string) => {
    if (url === '/execution-hosts') return { data: hosts };
    return { data: workspace };
  });
}

function renderHosts() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
  render(<ProjectWorkspaceHosts projectId="project-1" />, { wrapper });
}

describe('ProjectWorkspaceHosts', () => {
  beforeEach(() => {
    apiMocks.get.mockReset();
    apiMocks.put.mockReset();
    apiMocks.delete.mockReset();
    apiMocks.put.mockResolvedValue({ data: {} });
    apiMocks.delete.mockResolvedValue({ data: {} });
    useWorkerStore.getState().reset();
    native.isDesktop = false;
    native.selectFolder.mockReset().mockResolvedValue('/Users/me/paper');
    native.readContext.mockReset().mockResolvedValue([]);
  });

  it('records a path against the machine it belongs to', async () => {
    mockWorkspace({ is_available: false, is_offline: false, is_unconfigured: true, paths: [] });
    renderHosts();

    const input = await screen.findAllByPlaceholderText('Path on this machine');
    fireEvent.change(input[1], { target: { value: '/Users/me/papers' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save path' })[1]);

    await waitFor(() =>
      expect(apiMocks.put).toHaveBeenCalledWith('/projects/project-1/workspace/paths', {
        host_id: 'host-mac',
        path: '/Users/me/papers',
      }),
    );
  });

  function localWorkspace() {
    native.isDesktop = true;
    useWorkerStore.setState({ hostId: 'host-mac' });
    mockWorkspace({ is_available: false, is_offline: false, is_unconfigured: true, paths: [] });
    renderHosts();
  }

  it('only picks for this machine and waits for explicit apply before writing', async () => {
    localWorkspace();
    fireEvent.click(await screen.findByRole('button', { name: 'Browse…' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Path on this machine · MacBook')).toHaveValue(
        '/Users/me/paper',
      ),
    );
    expect(screen.getByLabelText('Path on this machine · Workstation')).toHaveValue('');
    expect(apiMocks.put).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Run here' }));
    await waitFor(() => expect(apiMocks.put).toHaveBeenCalledTimes(2));
    expect(native.readContext).toHaveBeenCalledWith('/Users/me/paper');
    expect(apiMocks.put).toHaveBeenNthCalledWith(1, '/projects/project-1/workspace/paths', {
      host_id: 'host-mac',
      path: '/Users/me/paper',
    });
    expect(apiMocks.put).toHaveBeenNthCalledWith(2, '/projects/project-1/workspace/host', {
      host_id: 'host-mac',
    });
    expect(native.readContext.mock.invocationCallOrder[0]).toBeLessThan(
      apiMocks.put.mock.invocationCallOrder[0],
    );
  });

  it('canceling the picker preserves the current draft', async () => {
    native.selectFolder.mockResolvedValue(null);
    localWorkspace();
    fireEvent.change(await screen.findByLabelText('Path on this machine · MacBook'), {
      target: { value: '/Users/me/draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Browse…' })).toBeEnabled());
    expect(screen.getByLabelText('Path on this machine · MacBook')).toHaveValue('/Users/me/draft');
    expect(apiMocks.put).not.toHaveBeenCalled();
  });

  it('does not change server settings when the folder check fails', async () => {
    native.readContext.mockRejectedValue(new Error('No directory'));
    localWorkspace();
    fireEvent.change(await screen.findByLabelText('Path on this machine · MacBook'), {
      target: { value: '~/missing' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run here' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a folder');
    expect(apiMocks.put).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Path on this machine · MacBook')).toHaveValue('~/missing');
  });

  it('keeps a failed binding draft after refetch and explains possible partial saving', async () => {
    apiMocks.put.mockImplementation(async (url: string) => {
      if (url.endsWith('/host')) throw new Error('Offline');
      mockWorkspace({
        host_id: 'host-mac',
        host_label: 'MacBook',
        path: '/Users/me/retry',
        is_available: true,
        is_offline: false,
        is_unconfigured: false,
        paths: [{ host_id: 'host-mac', path: '/Users/me/retry' }],
      });
      return { data: {} };
    });
    localWorkspace();
    fireEvent.change(await screen.findByLabelText('Path on this machine · MacBook'), {
      target: { value: '/Users/me/retry' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run here' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Path may be saved');
    await screen.findByText('Runs here');
    expect(screen.getByRole('button', { name: 'Run here' })).toBeEnabled();
    expect(screen.getByLabelText('Path on this machine · MacBook')).toHaveValue('/Users/me/retry');
    apiMocks.put.mockResolvedValue({ data: {} });
    fireEvent.click(screen.getByRole('button', { name: 'Run here' }));
    await waitFor(() => expect(apiMocks.put).toHaveBeenCalledTimes(4));
  });

  it('blocks duplicate applies while checking the directory', async () => {
    let finish!: (files: []) => void;
    native.readContext.mockReturnValue(
      new Promise<[]>((resolve) => {
        finish = resolve;
      }),
    );
    localWorkspace();
    fireEvent.change(await screen.findByLabelText('Path on this machine · MacBook'), {
      target: { value: '/Users/me/paper' },
    });
    const apply = screen.getByRole('button', { name: 'Run here' });
    fireEvent.click(apply);
    fireEvent.click(apply);
    expect(native.readContext).toHaveBeenCalledTimes(1);
    expect(apiMocks.put).not.toHaveBeenCalled();
    finish([]);
    await waitFor(() => expect(apiMocks.put).toHaveBeenCalledTimes(2));
  });

  it('does not offer local browsing on the web', async () => {
    useWorkerStore.setState({ hostId: 'host-mac' });
    mockWorkspace({ is_available: false, is_offline: false, is_unconfigured: true, paths: [] });
    renderHosts();
    await screen.findByLabelText('Path on this machine · MacBook');
    expect(screen.queryByRole('button', { name: 'Browse…' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Run here' })).toBeNull();
  });

  it('links unregistered desktops to machine settings', async () => {
    native.isDesktop = true;
    mockWorkspace({ is_available: false, is_offline: false, is_unconfigured: true, paths: [] });
    renderHosts();
    expect(
      await screen.findByRole('link', { name: /Open this machine's settings/ }),
    ).toHaveAttribute('href', '/settings#this-machine');
    expect(screen.queryByRole('button', { name: 'Browse…' })).toBeNull();
  });

  // Choosing a machine is deliberate: the button only appears where a path is
  // already recorded, because a machine with no path has nothing to run in.
  it('offers to run only on machines that have a path', async () => {
    mockWorkspace({
      host_id: 'host-ubuntu',
      host_label: 'Workstation',
      path: '/home/me/vla',
      is_available: true,
      is_offline: false,
      is_unconfigured: false,
      paths: [{ host_id: 'host-ubuntu', path: '/home/me/vla' }],
    });
    renderHosts();

    await screen.findByText('Workstation');
    // The chosen machine is marked, and the one without a path offers nothing.
    expect(screen.getByText('Runs here')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run here' })).toBeNull();
  });

  it('moves the project to another machine on request', async () => {
    mockWorkspace({
      host_id: 'host-ubuntu',
      host_label: 'Workstation',
      path: '/home/me/vla',
      is_available: true,
      is_offline: false,
      is_unconfigured: false,
      paths: [
        { host_id: 'host-ubuntu', path: '/home/me/vla' },
        { host_id: 'host-mac', path: '/Users/me/vla' },
      ],
    });
    renderHosts();

    fireEvent.click(await screen.findByRole('button', { name: 'Run here' }));

    await waitFor(() =>
      expect(apiMocks.put).toHaveBeenCalledWith('/projects/project-1/workspace/host', {
        host_id: 'host-mac',
      }),
    );
  });

  // An offline machine is not a misconfiguration, and saying so is the whole
  // point of showing status here: the work is refused until it is back.
  it('says an offline machine is offline rather than unset', async () => {
    mockWorkspace({
      host_id: 'host-mac',
      host_label: 'MacBook',
      path: '/Users/me/papers',
      is_available: false,
      is_offline: true,
      is_unconfigured: false,
      paths: [{ host_id: 'host-mac', path: '/Users/me/papers' }],
    });
    renderHosts();

    expect(
      await screen.findByText(/Offline — work here is refused until it is back/),
    ).toBeInTheDocument();
  });

  // Only the machine holding the folder can describe it, so the refresh
  // button exists only where this app is that machine.
  it('shows the folder snapshot and lets this machine refresh it', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    useWorkerStore.setState({ hostId: 'host-mac', refreshProjectContext: refresh });
    mockWorkspace({
      host_id: 'host-mac',
      host_label: 'MacBook',
      path: '/Users/me/papers',
      is_available: true,
      is_offline: false,
      is_unconfigured: false,
      paths: [{ host_id: 'host-mac', path: '/Users/me/papers' }],
      context_files: ['README.md', 'docs/INDEX.md'],
      context_updated_at: '2026-09-04T10:00:00Z',
    });
    renderHosts();

    expect(
      await screen.findByText(/Folder context: README.md, docs\/INDEX.md/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh context' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledWith('project-1', '/Users/me/papers'));

    useWorkerStore.setState({ hostId: 'host-ubuntu' });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Refresh context' })).toBeNull(),
    );
  });

  it('points somewhere useful when no machine has registered', async () => {
    apiMocks.get.mockImplementation(async (url: string) => {
      if (url === '/execution-hosts') return { data: [] };
      return { data: { is_available: false, is_offline: false, is_unconfigured: true, paths: [] } };
    });
    renderHosts();

    expect(await screen.findByText(/No machines registered yet/)).toBeInTheDocument();
  });
});
