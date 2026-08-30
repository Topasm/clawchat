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
  issueLocalSession: vi.fn(),
  getAppMode: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  verifyHealth: vi.fn(),
  loadSession: vi.fn(),
  saveSession: vi.fn(),
  removeSession: vi.fn(),
  apiGet: vi.fn(),
}));

vi.mock('../../../services/workspaceHealth', () => ({
  verifyClawChatHealth: mocks.verifyHealth,
}));
vi.mock('../../../services/workspaceCredentials', () => ({
  workspaceCredentialRef: (id: string) => `workspace-session-${id}`,
  loadWorkspaceSession: mocks.loadSession,
  saveWorkspaceSession: mocks.saveSession,
  removeWorkspaceSession: mocks.removeSession,
}));
vi.mock('../../../services/apiClient', () => ({
  default: { get: mocks.apiGet },
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
    runtime: { kind: 'tauri', os: 'macos', appVersion: '0.0.0-test', isDesktop: true },
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
      getAppMode: mocks.getAppMode,
      issueLocalSession: mocks.issueLocalSession,
      updateConfig: mocks.updateConfig,
      setAppMode: mocks.nativeSetAppMode,
      onStatusChange: vi.fn(() => () => {}),
      onRuntimeChange: vi.fn(() => () => {}),
      openLogFolder: vi.fn(),
      openDataFolder: vi.fn(),
    },
    system: { openCameraSettings: vi.fn() },
    secureStorage: null,
  },
}));

const { useAuthStore } = await import('../../../stores/useAuthStore');
const { useHostSessionStore } = await import('../../../stores/useHostSessionStore');
const { useWorkspaceStore } = await import('../../../stores/useWorkspaceStore');
const { useWorkspaceRuntimeStore } = await import('../../../stores/useWorkspaceRuntimeStore');
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
    appMode: 'host',
    localServerEnabled: true,
    keepRunningInTray: true,
    autoStartHost: false,
    lanAccess: false,
    port: 8000,
    pinConfigured: true,
    defaultPinInUse: false,
    obsidianVaultPath: '',
    hostServerUrl: '',
  });
  mocks.updateConfig.mockImplementation(async (updates) => ({
    config: { ...(await mocks.getConfig()), ...updates },
    previousStatus: { state: 'running', port: 8000 },
    status: { state: updates.localServerEnabled === false ? 'stopped' : 'running', port: 8000 },
    applied: true,
    restartRequired: false,
  }));
  mocks.setAppMode.mockResolvedValue(undefined);
  mocks.nativeSetAppMode.mockResolvedValue({
    config: {},
    previousStatus: { state: 'running', port: 8000 },
    status: { state: 'running', port: 8000 },
    applied: true,
    restartRequired: false,
  });
  mocks.getAppMode.mockImplementation(async () => mocks.appMode);
  mocks.issueLocalSession.mockResolvedValue({
    access_token: 'local-token',
    refresh_token: 'local-refresh',
  });
  mocks.login.mockResolvedValue({
    hostId: 'claw_test',
    hostPublicKey: 'public-key',
    apiVersion: '1',
    workspaceName: 'ClawChat',
  });
  mocks.verifyHealth.mockResolvedValue({
    service: 'clawchat',
    status: 'ok',
    version: '0.1.5',
    apiVersion: '1',
    hostId: 'claw_test',
    hostPublicKey: 'public-key',
  });
  mocks.loadSession.mockResolvedValue(null);
  mocks.saveSession.mockResolvedValue(undefined);
  mocks.removeSession.mockResolvedValue(undefined);
  mocks.apiGet.mockResolvedValue({ data: {} });
  useHostSessionStore.getState().reset();
  useWorkspaceRuntimeStore.getState().reset();
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
    expect(mocks.updateConfig).not.toHaveBeenCalled();
    expect(mocks.nativeSetAppMode).not.toHaveBeenCalledWith('client');
    expect(useWorkspaceStore.getState().profiles).toContainEqual(
      expect.objectContaining({ name: 'Home', serverUrl: 'https://home.example' }),
    );
    expect(localStorage.getItem('workspace-connections')).not.toContain('654321');
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
    expect(mocks.nativeSetAppMode).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('local');
  });

  it('rolls back auth and workspace state when a remote identity changes during sign-in', async () => {
    mocks.login.mockImplementationOnce(async () => {
      useAuthStore.setState({ token: 'untrusted-token', serverUrl: 'https://work.example' });
      return {
        hostId: 'different-host',
        hostPublicKey: 'different-key',
        apiVersion: '1',
        workspaceName: 'Changed host',
      };
    });
    renderSection();

    fireEvent.change(screen.getByPlaceholderText('https://clawchat.example.com'), {
      target: { value: 'https://work.example' },
    });
    fireEvent.change(screen.getByPlaceholderText('Not saved'), {
      target: { value: '654321' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    expect(await screen.findByText(/server identity changed/)).toBeInTheDocument();
    expect(useAuthStore.getState().token).toBe('local-token');
    expect(useAuthStore.getState().serverUrl).toBe('http://localhost:8000');
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('local');
    expect(useWorkspaceStore.getState().profiles).toHaveLength(1);
  });

  it('restores the prior workspace if secure session persistence fails', async () => {
    mocks.saveSession.mockRejectedValueOnce(new Error('Credential vault unavailable'));
    renderSection();

    fireEvent.change(screen.getByPlaceholderText('https://clawchat.example.com'), {
      target: { value: 'https://work.example' },
    });
    fireEvent.change(screen.getByPlaceholderText('Not saved'), {
      target: { value: '654321' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    expect(await screen.findByText('Credential vault unavailable')).toBeInTheDocument();
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('local');
    expect(useWorkspaceStore.getState().profiles).toHaveLength(1);
  });

  it('quick-switches with a saved secure session without asking for the PIN again', async () => {
    const remote = useWorkspaceStore
      .getState()
      .upsertRemote('Lab', 'https://lab.example', { hostId: 'claw_test', apiVersion: '1' });
    useWorkspaceStore.getState().setActiveWorkspace('local');
    mocks.loadSession.mockResolvedValueOnce({
      token: 'saved-token',
      refreshToken: 'saved-refresh',
      serverUrl: 'https://lab.example',
      hostId: 'claw_test',
      hostPublicKey: 'public-key',
      relayUrl: null,
    });
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Use' }));

    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalledWith('/capabilities'));
    expect(mocks.login).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(remote.id);
    expect(useAuthStore.getState().token).toBe('saved-token');
  });

  it('moves focus to the PIN field when a saved remote workspace needs authentication', async () => {
    useWorkspaceStore
      .getState()
      .upsertRemote('Lab', 'https://lab.example', { hostId: 'claw_test', apiVersion: '1' });
    useWorkspaceStore.getState().setActiveWorkspace('local');
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Use' }));

    expect(
      await screen.findByText('Enter the PIN for this workspace to connect.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByPlaceholderText('Not saved')).toHaveFocus());
  });

  it('keeps remote credentials until the local workspace is ready', async () => {
    mocks.appMode = 'client';
    useWorkspaceStore.getState().upsertRemote('Work', 'https://work.example');
    useAuthStore.setState({ token: 'remote-token', serverUrl: 'https://work.example' });
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Use' }));

    await waitFor(() =>
      expect(mocks.updateConfig).toHaveBeenCalledWith({ localServerEnabled: true }),
    );
    expect(mocks.issueLocalSession).toHaveBeenCalledTimes(1);
    expect(mocks.logout).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('local');
  });

  it('returns to the remote workspace if local startup fails', async () => {
    mocks.appMode = 'client';
    const remote = useWorkspaceStore.getState().upsertRemote('Work', 'https://work.example');
    useAuthStore.setState({ token: 'remote-token', serverUrl: 'https://work.example' });
    mocks.updateConfig.mockRejectedValueOnce(new Error('Local engine unavailable'));
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Use' }));

    expect(await screen.findByText('Local engine unavailable')).toBeInTheDocument();
    expect(mocks.nativeSetAppMode).not.toHaveBeenCalledWith('client');
    expect(mocks.logout).not.toHaveBeenCalled();
    expect(useAuthStore.getState().token).toBe('remote-token');
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(remote.id);
  });
});
