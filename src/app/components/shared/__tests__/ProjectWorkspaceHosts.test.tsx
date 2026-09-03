import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProjectWorkspaceHosts from '../ProjectWorkspaceHosts';

const apiMocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), delete: vi.fn() }));

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
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
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

  it('points somewhere useful when no machine has registered', async () => {
    apiMocks.get.mockImplementation(async (url: string) => {
      if (url === '/execution-hosts') return { data: [] };
      return { data: { is_available: false, is_offline: false, is_unconfigured: true, paths: [] } };
    });
    renderHosts();

    expect(await screen.findByText(/No machines registered yet/)).toBeInTheDocument();
  });
});
