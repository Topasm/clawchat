import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '../../../stores/useSettingsStore';
import ProjectCreateDialog from '../ProjectCreateDialog';

const mocks = vi.hoisted(() => ({
  createProject: vi.fn(),
  registerHost: vi.fn(),
  bindWorkspace: vi.fn(),
  navigate: vi.fn(),
  selectFolder: vi.fn(),
  hosts: [] as Array<Record<string, unknown>>,
  isDesktop: false,
}));

vi.mock('../../../hooks/queries', () => ({
  useCreateProject: () => ({ mutateAsync: mocks.createProject, isPending: false }),
  useRegisterWorkerHost: () => ({ mutateAsync: mocks.registerHost, isPending: false }),
  useBindProjectWorkspace: () => ({ mutateAsync: mocks.bindWorkspace, isPending: false }),
  useExecutionHostsQuery: () => ({ data: mocks.hosts, isLoading: false }),
}));
vi.mock('../../../hooks/usePlatform', () => ({
  default: () => ({ isDesktop: mocks.isDesktop, isMobile: false }),
}));
vi.mock('../../../platform', () => ({
  platformApi: {
    runtime: { os: 'linux' },
    server: { selectFolder: mocks.selectFolder },
  },
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mocks.navigate };
});

const serverHost = { id: 'host-server', label: 'Workstation', kind: 'local', is_enabled: true };
const macHost = { id: 'host-mac', label: 'MacBook', kind: 'worker', is_enabled: true };

function renderDialog() {
  return render(
    <MemoryRouter>
      <ProjectCreateDialog open onOpenChange={vi.fn()} />
    </MemoryRouter>,
  );
}

function fillTitle(title: string) {
  fireEvent.change(screen.getByPlaceholderText('What are you working toward?'), {
    target: { value: title },
  });
}

describe('ProjectCreateDialog', () => {
  beforeEach(() => {
    mocks.createProject.mockReset().mockResolvedValue({ id: 'project-new' });
    mocks.registerHost
      .mockReset()
      .mockResolvedValue({ id: 'host-here', label: 'My Linux machine' });
    mocks.bindWorkspace.mockReset().mockResolvedValue(undefined);
    mocks.navigate.mockReset();
    mocks.selectFolder.mockReset();
    mocks.hosts = [serverHost, macHost];
    mocks.isDesktop = false;
    useSettingsStore.setState({ workerEnabled: false, workerLabel: '' });
  });

  it('creates a project without a folder exactly as before', async () => {
    renderDialog();
    fillTitle('Paper draft');
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/projects/project-new'));
    expect(mocks.createProject).toHaveBeenCalledWith({ title: 'Paper draft', goal: null });
    expect(mocks.bindWorkspace).not.toHaveBeenCalled();
    expect(mocks.registerHost).not.toHaveBeenCalled();
  });

  it('binds the folder to the chosen machine right after creating', async () => {
    renderDialog();
    fillTitle('E65 experiments');
    fireEvent.change(screen.getByPlaceholderText('Path on that machine'), {
      target: { value: '~/Desktop/srp_e65' },
    });
    // The server itself is the default when this machine is not a worker.
    const machine = screen.getByLabelText('Machine') as HTMLSelectElement;
    expect(machine.value).toBe('host-server');
    fireEvent.change(machine, { target: { value: 'host-mac' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/projects/project-new'));
    expect(mocks.bindWorkspace).toHaveBeenCalledWith({
      projectId: 'project-new',
      hostId: 'host-mac',
      path: '~/Desktop/srp_e65',
    });
  });

  it('refuses a folder with no machine to hold it', () => {
    mocks.hosts = [];
    renderDialog();
    fillTitle('Homeless');
    fireEvent.change(screen.getByPlaceholderText('Path on that machine'), {
      target: { value: '/tmp/work' },
    });

    expect(screen.getByText(/No machines registered/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create project' })).toBeDisabled();
  });

  it('registers this desktop as a worker on the way, picking the folder natively', async () => {
    mocks.isDesktop = true;
    mocks.selectFolder.mockResolvedValue('/home/me/lab');
    renderDialog();
    fillTitle('Lab');
    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }));
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Path on that machine')).toHaveValue('/home/me/lab'),
    );

    fireEvent.click(screen.getByRole('switch', { name: 'Run work on this machine' }));
    expect(screen.getByLabelText('Name for this machine')).toHaveValue('My Linux machine');
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/projects/project-new'));
    expect(mocks.registerHost).toHaveBeenCalledWith({
      label: 'My Linux machine',
      platform: 'linux',
    });
    expect(mocks.bindWorkspace).toHaveBeenCalledWith({
      projectId: 'project-new',
      hostId: 'host-here',
      path: '/home/me/lab',
    });
    // The settings toggle and this dialog write the same store.
    expect(useSettingsStore.getState().workerEnabled).toBe(true);
    expect(useSettingsStore.getState().workerLabel).toBe('My Linux machine');
  });

  it('defaults to this machine when it is already a registered worker', () => {
    mocks.isDesktop = true;
    useSettingsStore.setState({ workerEnabled: true, workerLabel: 'MacBook' });
    renderDialog();
    fillTitle('Notes');
    fireEvent.change(screen.getByPlaceholderText('Path on that machine'), {
      target: { value: '~/notes' },
    });

    expect((screen.getByLabelText('Machine') as HTMLSelectElement).value).toBe('host-mac');
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });
});
