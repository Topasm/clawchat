import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ServerStatus } from '../../platform';

const serverMocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  getConfig: vi.fn(),
  getNetworkInfo: vi.fn(),
  updateConfig: vi.fn(),
  issueLocalSession: vi.fn(),
  selectFolder: vi.fn(),
  openObsidianVault: vi.fn(),
  setAppMode: vi.fn(),
  getAppMode: vi.fn(),
  onStatusChange: vi.fn(() => () => {}),
  onRuntimeChange: vi.fn(() => () => {}),
}));
const routerMocks = vi.hoisted(() => ({ navigate: vi.fn() }));

// Making the adapter report a desktop runtime is what flips `IS_DESKTOP`, so
// this single mock puts the whole page in Tauri mode.
vi.mock('../../platform', () => ({
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
    server: serverMocks,
    system: { openCameraSettings: vi.fn() },
    secureStorage: null,
  },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => routerMocks.navigate };
});

const { ThemeProvider } = await import('../../config/ThemeProvider');
const { useHostSessionStore } = await import('../../stores/useHostSessionStore');
const { useAuthStore } = await import('../../stores/useAuthStore');
const { useWorkspaceStore } = await import('../../stores/useWorkspaceStore');
const LoginPage = (await import('../LoginPage')).default;

function renderLoginPage() {
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

function hostStatus(partial: Partial<ServerStatus> = {}): ServerStatus {
  return { state: 'running', port: 8000, ...partial };
}

beforeEach(() => {
  vi.clearAllMocks();
  serverMocks.getAppMode.mockResolvedValue('host');
  serverMocks.getStatus.mockResolvedValue(hostStatus());
  serverMocks.getConfig.mockResolvedValue({
    appMode: 'host',
    localServerEnabled: true,
    keepRunningInTray: true,
    port: 8000,
    pinConfigured: true,
    defaultPinInUse: false,
    obsidianVaultPath: '',
    hostServerUrl: '',
    autoStartHost: false,
  });
  serverMocks.updateConfig.mockResolvedValue({
    config: {},
    previousStatus: hostStatus(),
    status: hostStatus(),
    applied: true,
    restartRequired: false,
  });
  serverMocks.issueLocalSession.mockResolvedValue({
    access_token: 'local-token',
    refresh_token: 'local-refresh',
  });
  serverMocks.setAppMode.mockResolvedValue({ appMode: 'host', port: 8000, pin: '123456' });
  useAuthStore.setState({ token: null, isLoading: false, login: vi.fn() });
  useWorkspaceStore.getState().reset();
  useHostSessionStore.setState({
    phase: 'checking',
    status: null,
    failure: null,
    isHostMode: true,
  });
});

describe('LoginPage on a desktop host', () => {
  it('shows the sidecar state instead of a PIN form', async () => {
    useHostSessionStore.setState({ phase: 'starting', status: hostStatus({ state: 'starting' }) });
    renderLoginPage();

    expect(await screen.findByText('Preparing your local workspace')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Enter your PIN')).not.toBeInTheDocument();
  });

  it('reports that it is connecting once the server answers', async () => {
    useHostSessionStore.setState({ phase: 'connecting', status: hostStatus() });
    renderLoginPage();

    expect(await screen.findByText('Opening your workspace')).toBeInTheDocument();
  });

  it('shows the reason a blocked sidecar reported, verbatim', async () => {
    useHostSessionStore.setState({
      phase: 'blocked',
      status: hostStatus({
        state: 'error',
        error: 'legacy data import failed; host startup blocked: database is corrupt',
      }),
    });
    renderLoginPage();

    const reason = await screen.findByTestId('host-startup-reason');
    expect(reason).toHaveTextContent(
      'legacy data import failed; host startup blocked: database is corrupt',
    );
  });

  it('names the log file that holds the rest of the story', async () => {
    useHostSessionStore.setState({
      phase: 'blocked',
      status: hostStatus({ state: 'error', error: 'server failed health check after startup' }),
    });
    renderLoginPage();

    const panel = await screen.findByTestId('host-startup-panel');
    expect(panel.textContent).toContain('com.clawchat.desktop');
    expect(panel.textContent).toContain('startup.log');
    expect(panel.textContent).toContain('server.log');
  });

  it('explains a stopped sidecar even when it reported no error', async () => {
    useHostSessionStore.setState({ phase: 'blocked', status: hostStatus({ state: 'stopped' }) });
    renderLoginPage();

    expect(await screen.findByTestId('host-startup-reason')).toHaveTextContent(
      'The local server is not running, and it did not report a reason.',
    );
  });

  it('distinguishes a refused PIN from an unreachable server', async () => {
    useHostSessionStore.setState({
      phase: 'blocked',
      status: hostStatus(),
      failure: { kind: 'rejected', message: 'Login failed. Check your server URL and PIN.' },
    });
    renderLoginPage();

    expect(await screen.findByTestId('host-startup-reason')).toHaveTextContent(
      'The local server refused the saved PIN.',
    );
  });

  it('offers a retry that asks the shell to start hosting again', async () => {
    useHostSessionStore.setState({
      phase: 'blocked',
      status: hostStatus({ state: 'error', error: 'packaged server binary is missing' }),
    });
    renderLoginPage();

    fireEvent.click(
      await screen.findByRole('button', { name: /try opening the workspace again/i }),
    );

    await waitFor(() =>
      expect(serverMocks.updateConfig).toHaveBeenCalledWith({ localServerEnabled: true }),
    );
  });

  it('keeps manual sign-in available as a collapsed fallback', async () => {
    useHostSessionStore.setState({
      phase: 'blocked',
      status: hostStatus({ state: 'error', error: 'server failed health check after startup' }),
    });
    renderLoginPage();

    expect(screen.queryByPlaceholderText('Enter your PIN')).not.toBeInTheDocument();

    fireEvent.click(
      await screen.findByRole('button', { name: /if this keeps happening, sign in manually/i }),
    );

    expect(await screen.findByPlaceholderText('Enter your PIN')).toBeInTheDocument();
    // The packaged shell's page origin is `tauri://`, so the fallback has to be
    // pointed at the sidecar's real port instead.
    expect(screen.getByText('Server: http://localhost:8000')).toBeInTheDocument();
  });
});

describe('LoginPage on a desktop client', () => {
  it('keeps the pairing and manual sign-in paths untouched', async () => {
    useWorkspaceStore.getState().upsertRemote('Home', 'http://192.168.1.20:8000');
    useHostSessionStore.setState({ phase: 'idle', isHostMode: false });
    renderLoginPage();

    expect(await screen.findByRole('button', { name: /use local workspace/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /scan qr code/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter your PIN')).toBeInTheDocument();
    expect(screen.queryByTestId('host-startup-panel')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByDisplayValue('http://192.168.1.20:8000')).toBeInTheDocument(),
    );
  });

  it('waits for the server to settle before reporting a failed switch to hosting', async () => {
    useWorkspaceStore.getState().upsertRemote('Home', 'http://192.168.1.20:8000');
    serverMocks.getStatus.mockResolvedValue(
      hostStatus({ state: 'error', error: 'packaged server binary is missing' }),
    );
    useHostSessionStore.setState({ phase: 'idle', isHostMode: false });
    renderLoginPage();

    fireEvent.click(await screen.findByRole('button', { name: /use local workspace/i }));

    // The old handler logged in the instant the mode flipped, so a sidecar that
    // never came up surfaced as a generic credential error.
    expect(await screen.findByText(/packaged server binary is missing/)).toBeInTheDocument();
    expect(routerMocks.navigate).not.toHaveBeenCalled();
  });
});
