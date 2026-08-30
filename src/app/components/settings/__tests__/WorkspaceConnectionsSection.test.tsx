import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appMode: 'host' as 'host' | 'client',
  setAppMode: vi.fn(),
  nativeSetAppMode: vi.fn(),
  updateConfig: vi.fn(),
  getStatus: vi.fn(),
  getConfig: vi.fn(),
  navigate: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('../../../hooks/useAppMode', () => ({
  useAppMode: () => ({
    appMode: mocks.appMode,
    setAppMode: mocks.setAppMode,
    isHost: mocks.appMode === 'host',
    isClient: mocks.appMode === 'client',
    loading: false,
  }),
}));

vi.mock('../../../platform', () => ({
  platformApi: {
    runtime: { kind: 'tauri', os: 'desktop', appVersion: '0.0.0-test', isDesktop: true },
    events: { on: () => () => {} },
    notifications: { show: vi.fn(), setBadgeCount: vi.fn() },
    updater: {
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      installUpdate: vi.fn(),
      onUpdateAvailable: () => () => {},
      onUpdateNotAvailable: () => () => {},
      onDownloadProgress: () => () => {},
      onUpdateDownloaded: () => () => {},
    },
    server: {
      getStatus: mocks.getStatus,
      getConfig: mocks.getConfig,
      updateConfig: mocks.updateConfig,
      setAppMode: mocks.nativeSetAppMode,
      onStatusChange: vi.fn(() => () => {}),
    },
    system: { openCameraSettings: vi.fn() },
    secureStorage: null,
  },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mocks.navigate };
});

const { useAuthStore } = await import('../../../stores/useAuthStore');
const { useHostSessionStore } = await import('../../../stores/useHostSessionStore');
const { useWorkspaceStore } = await import('../../../stores/useWorkspaceStore');
const WorkspaceConnectionsSection = (await import('../WorkspaceConnectionsSection')).default;

function renderSection() {
  return render(
    <MemoryRouter>
      <WorkspaceConnectionsSection />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.appMode = 'host';
  mocks.getStatus.mockResolvedValue({ state: 'running', port: 8000 });
  mocks.getConfig.mockResolvedValue({
    autoStartHost: false,
    lanAccess: false,
    port: 8000,
    pin: '123456',
  });
  mocks.updateConfig.mockResolvedValue({});
  mocks.setAppMode.mockResolvedValue(undefined);
  mocks.nativeSetAppMode.mockResolvedValue(undefined);
  mocks.login.mockResolvedValue(undefined);
  useHostSessionStore.getState().reset();
  useWorkspaceStore.getState().reset();
  useAuthStore.setState({
    token: 'local-token',
    serverUrl: 'http://localhost:8000',
    login: mocks.login,
    logout: mocks.logout,
  });
});

describe('WorkspaceConnectionsSection', () => {
  it('presents this device as the no-setup default', async () => {
    renderSection();

    expect(screen.getByText('This device')).toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(screen.getByText(/No account, server address, or PIN required/)).toBeInTheDocument();
    expect(await screen.findByText(/Local port 8000/)).toBeInTheDocument();
  });

  it('updates the PIN while explicitly enabling trusted LAN access', async () => {
    renderSection();

    const pinInput = await screen.findByLabelText('Local network PIN');
    fireEvent.change(pinInput, { target: { value: '938274' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Allow local network access' }));

    await waitFor(() =>
      expect(mocks.updateConfig).toHaveBeenCalledWith({
        pin: '938274',
        lanAccess: true,
      }),
    );
  });

  it('authenticates before switching away from local and never persists the PIN', async () => {
    renderSection();

    fireEvent.change(screen.getByPlaceholderText('Home server'), {
      target: { value: 'Home' },
    });
    fireEvent.change(screen.getByPlaceholderText('https://clawchat.example.com'), {
      target: { value: 'https://home.example/' },
    });
    fireEvent.change(screen.getByPlaceholderText('Not saved'), {
      target: { value: '654321' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => expect(mocks.login).toHaveBeenCalledWith('https://home.example', '654321'));
    expect(mocks.updateConfig).toHaveBeenCalledWith({
      hostServerUrl: 'https://home.example',
    });
    expect(mocks.setAppMode).toHaveBeenCalledWith('client');
    expect(useWorkspaceStore.getState().profiles).toContainEqual(
      expect.objectContaining({ name: 'Home', serverUrl: 'https://home.example' }),
    );
    expect(localStorage.getItem('workspace-connections')).not.toContain('654321');
    expect(mocks.navigate).toHaveBeenCalledWith('/today');
  });

  it('keeps local mode running when remote authentication fails', async () => {
    mocks.login.mockRejectedValueOnce(new Error('Invalid PIN'));
    renderSection();

    fireEvent.change(screen.getByPlaceholderText('https://clawchat.example.com'), {
      target: { value: 'https://work.example' },
    });
    fireEvent.change(screen.getByPlaceholderText('Not saved'), {
      target: { value: 'wrong' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    expect(await screen.findByText('Invalid PIN')).toBeInTheDocument();
    expect(mocks.setAppMode).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('local');
  });

  it('keeps remote credentials until the local workspace is ready', async () => {
    mocks.appMode = 'client';
    useWorkspaceStore.getState().upsertRemote('Work', 'https://work.example');
    useAuthStore.setState({ token: 'remote-token', serverUrl: 'https://work.example' });
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Use' }));

    await waitFor(() => expect(mocks.nativeSetAppMode).toHaveBeenCalledWith('host'));
    expect(mocks.login).toHaveBeenCalledWith('http://localhost:8000', '123456');
    expect(mocks.logout).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('local');
    expect(mocks.navigate).toHaveBeenCalledWith('/today');
  });

  it('returns to the remote workspace if local startup fails', async () => {
    mocks.appMode = 'client';
    const remote = useWorkspaceStore.getState().upsertRemote('Work', 'https://work.example');
    useAuthStore.setState({ token: 'remote-token', serverUrl: 'https://work.example' });
    mocks.nativeSetAppMode.mockRejectedValueOnce(new Error('Local engine unavailable'));
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Use' }));

    expect(await screen.findByText('Local engine unavailable')).toBeInTheDocument();
    expect(mocks.setAppMode).toHaveBeenCalledWith('client');
    expect(mocks.logout).not.toHaveBeenCalled();
    expect(useAuthStore.getState().token).toBe('remote-token');
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(remote.id);
  });
});
