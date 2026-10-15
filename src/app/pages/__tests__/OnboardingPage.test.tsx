import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ServerConfig, ServerConfigUpdate, ServerStatus } from '../../platform';

const serverMocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  getConfig: vi.fn(),
  getNetworkInfo: vi.fn(),
  updateConfig: vi.fn(),
  issueLocalSession: vi.fn(),
  selectFolder: vi.fn(),
  openObsidianVault: vi.fn(),
  openLogFolder: vi.fn(),
  openDataFolder: vi.fn(),
  setAppMode: vi.fn(),
  getAppMode: vi.fn(),
  onStatusChange: vi.fn(() => () => {}),
  onRuntimeChange: vi.fn(() => () => {}),
}));
const apiMocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const coordinatorMocks = vi.hoisted(() => ({
  connectRemoteWorkspace: vi.fn(),
  connectPairedWorkspace: vi.fn(),
}));
const routerMocks = vi.hoisted(() => ({ navigate: vi.fn() }));
const platformState = vi.hoisted(() => ({ worker: null as object | null }));

vi.mock('../../platform', () => ({
  platformApi: {
    runtime: { kind: 'tauri', os: 'linux', appVersion: '0.0.0-test', isDesktop: true },
    events: { on: () => () => {} },
    notifications: { show: vi.fn(), setBadgeCount: vi.fn() },
    server: serverMocks,
    system: { openCameraSettings: vi.fn() },
    secureStorage: null,
    get worker() {
      return platformState.worker;
    },
  },
}));
vi.mock('../../services/apiClient', () => ({ default: apiMocks }));
vi.mock('../../services/workspaceSessionCoordinator', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/workspaceSessionCoordinator')>()),
  ...coordinatorMocks,
}));
vi.mock('../../components/pairing/PairingCodeDisplay', () => ({
  default: ({ onPaired }: { onPaired?: () => void }) => (
    <button type="button" onClick={onPaired}>
      Pairing QR
    </button>
  ),
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => routerMocks.navigate,
}));

const { ThemeProvider } = await import('../../config/ThemeProvider');
const { useAuthStore } = await import('../../stores/useAuthStore');
const { useFirstRunStore } = await import('../../stores/useFirstRunStore');
const { useHostSessionStore } = await import('../../stores/useHostSessionStore');
const { useWorkspaceStore } = await import('../../stores/useWorkspaceStore');
const { useWorkspaceRuntimeStore } = await import('../../stores/useWorkspaceRuntimeStore');
const OnboardingPage = (await import('../OnboardingPage')).default;

const running: ServerStatus = { state: 'running', port: 8000 };
let config: ServerConfig;

function freshConfig(): ServerConfig {
  return {
    appMode: 'host',
    localServerEnabled: false,
    keepRunningInTray: false,
    port: 8000,
    pinConfigured: true,
    defaultPinInUse: true,
    obsidianVaultPath: '',
    hostServerUrl: '',
    autoStartHost: false,
    lanAccess: false,
  };
}

function renderWizard(state?: { returnTo: string }, search = '') {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[{ pathname: '/onboarding', search, state }]}>
        <OnboardingPage />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

const providerState = {
  active_provider: 'openclaw',
  openclaw_connected: false,
  claude_code_status: 'available',
  claude_code_version: '2.0.0',
  codex_cli_status: 'not_installed',
  codex_cli_version: null,
  codex_cli_model: 'gpt-6-luna',
  codex_api_status: 'not_configured',
  codex_api_configured: false,
  codex_api_key_persistent: false,
  codex_model: 'gpt-6',
};

async function runLocalServer() {
  fireEvent.click(await screen.findByRole('button', { name: /run a server on this machine/i }));
  expect(await screen.findByText('Connected to This computer')).toBeInTheDocument();
}

function next() {
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
}

function skipStep() {
  fireEvent.click(screen.getByRole('button', { name: 'Skip this step' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  platformState.worker = null;
  config = freshConfig();
  serverMocks.getConfig.mockImplementation(async () => config);
  serverMocks.getStatus.mockResolvedValue(running);
  serverMocks.updateConfig.mockImplementation(async (updates: ServerConfigUpdate) => {
    const { pin, ...rest } = updates;
    config = { ...config, ...rest, ...(pin ? { defaultPinInUse: false } : {}) };
    return {
      config,
      previousStatus: running,
      status: running,
      applied: true,
      restartRequired: false,
    };
  });
  serverMocks.issueLocalSession.mockResolvedValue({ access_token: 'local-token' });
  apiMocks.get.mockResolvedValue({ data: providerState });
  useAuthStore.setState({ token: null, serverUrl: null, isLoading: false });
  useWorkspaceStore.getState().reset();
  useHostSessionStore.getState().reset();
  useHostSessionStore.setState({ phase: 'blocked', isHostMode: true });
  useWorkspaceRuntimeStore.getState().reset();
  useFirstRunStore.setState({ outcome: null, finishedAt: null });
});

describe('first-run setup wizard', () => {
  it('records that setup started as soon as it opens', async () => {
    renderWizard();

    expect(await screen.findByText('Where should ClawChat run?')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('first-run-setup')!).state.outcome).toBeNull();
  });

  it('starts the local server and signs in to it', async () => {
    renderWizard();
    const nextButton = await screen.findByRole('button', { name: 'Next' });
    expect(nextButton).toBeDisabled();

    await runLocalServer();

    expect(serverMocks.updateConfig).toHaveBeenCalledWith({ localServerEnabled: true });
    expect(useAuthStore.getState().token).toBe('local-token');
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  it('connects to another server with its PIN', async () => {
    coordinatorMocks.connectRemoteWorkspace.mockImplementation(async () => {
      useAuthStore.setState({ token: 'remote-token', serverUrl: 'https://home.example' });
      return useWorkspaceStore.getState().upsertRemote('Home', 'https://home.example');
    });
    renderWizard();

    fireEvent.click(await screen.findByRole('button', { name: /connect to another server/i }));
    fireEvent.change(screen.getByLabelText('Server URL'), {
      target: { value: 'https://home.example' },
    });
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '482913' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    expect(await screen.findByText('Connected to Home')).toBeInTheDocument();
    expect(coordinatorMocks.connectRemoteWorkspace).toHaveBeenCalledWith({
      name: '',
      remoteUrl: 'https://home.example',
      pin: '482913',
      selectedProfileId: null,
    });
  });

  it('connects to another server with a pairing code', async () => {
    coordinatorMocks.connectPairedWorkspace.mockImplementation(async () => {
      useAuthStore.setState({ token: 'device-token', serverUrl: 'https://home.example' });
      return useWorkspaceStore.getState().upsertRemote('', 'https://home.example');
    });
    renderWizard();

    fireEvent.click(await screen.findByRole('button', { name: /connect to another server/i }));
    fireEvent.change(screen.getByLabelText('Server URL'), {
      target: { value: 'https://home.example/' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Pairing code' }));
    fireEvent.change(screen.getByLabelText('Pairing code'), { target: { value: ' 123456 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    expect(await screen.findByText('Connected to home.example')).toBeInTheDocument();
    expect(coordinatorMocks.connectPairedWorkspace).toHaveBeenCalledWith(
      { type: 'clawchat_pair', server_url: 'https://home.example', code: '123456' },
      expect.objectContaining({ type: 'web' }),
    );
  });

  it('shows why a connection failed', async () => {
    coordinatorMocks.connectRemoteWorkspace.mockRejectedValue(new Error('Invalid PIN'));
    renderWizard();

    fireEvent.click(await screen.findByRole('button', { name: /connect to another server/i }));
    fireEvent.change(screen.getByLabelText('Server URL'), {
      target: { value: 'https://home.example' },
    });
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not connect');
    expect(alert).toHaveTextContent('Invalid PIN');
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('switches the AI provider and reports a passing check', async () => {
    apiMocks.post.mockImplementation(async (url: string) =>
      url === '/admin/ai/provider'
        ? { data: { ...providerState, active_provider: 'claude_code' } }
        : { data: { connected: true, latency_ms: 412.4, error: null } },
    );
    renderWizard();
    await runLocalServer();
    next();

    fireEvent.click(await screen.findByRole('button', { name: 'Claude Code' }));
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));

    expect(await screen.findByText('Claude Code is working')).toBeInTheDocument();
    expect(screen.getByText('Answered in 412 ms')).toBeInTheDocument();
    expect(apiMocks.post).toHaveBeenNthCalledWith(
      1,
      '/admin/ai/provider',
      { provider: 'claude_code' },
      { queueOfflineMutation: false },
    );
    expect(apiMocks.post).toHaveBeenNthCalledWith(2, '/admin/ai/test', undefined, {
      queueOfflineMutation: false,
    });
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  it('reports a failing AI check with what to do next', async () => {
    apiMocks.post.mockResolvedValue({
      data: { connected: false, latency_ms: null, error: 'Connection refused' },
    });
    renderWizard();
    await runLocalServer();
    next();

    fireEvent.click(await screen.findByRole('button', { name: 'Test connection' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('OpenClaw is not working');
    expect(alert).toHaveTextContent('Connection refused');
    expect(alert).toHaveTextContent('AI_BASE_URL');
    expect(apiMocks.post).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Skip this step' })).toBeEnabled();
  });

  it('saves the Obsidian vault of the local server', async () => {
    serverMocks.selectFolder.mockResolvedValue('/home/me/Vault');
    renderWizard();
    await runLocalServer();
    next();
    skipStep();

    fireEvent.click(await screen.findByRole('button', { name: 'Choose vault folder' }));

    expect(await screen.findByText('Vault connected')).toBeInTheDocument();
    expect(screen.getByText('/home/me/Vault')).toBeInTheDocument();
    expect(serverMocks.updateConfig).toHaveBeenCalledWith({ obsidianVaultPath: '/home/me/Vault' });
  });

  it('points a remote workspace at its own vault', async () => {
    useAuthStore.setState({ token: 'remote-token', serverUrl: 'https://home.example' });
    useWorkspaceStore.getState().upsertRemote('Home', 'https://home.example');
    renderWizard();
    next();
    skipStep();

    expect(
      await screen.findByText(/Home uses the vault configured on that server/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose vault folder' })).not.toBeInTheDocument();
    // Without the desktop worker there is nothing to share this vault with.
    expect(
      screen.queryByRole('button', { name: "Share this computer's vault" }),
    ).not.toBeInTheDocument();
  });

  it("offers to share this computer's vault with a remote workspace", async () => {
    platformState.worker = {};
    useAuthStore.setState({ token: 'remote-token', serverUrl: 'https://home.example' });
    useWorkspaceStore.getState().upsertRemote('Home', 'https://home.example');
    renderWizard();
    next();
    skipStep();

    expect(
      await screen.findByText(/share the vault on this computer through Home/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: "Share this computer's vault" }));

    expect(routerMocks.navigate).toHaveBeenCalledWith('/settings/workspace#share-this-machine', {
      state: { settingsReturnTo: '/onboarding?step=obsidian' },
    });
  });

  it('comes back from settings on the step it left', async () => {
    useAuthStore.setState({ token: 'remote-token', serverUrl: 'https://home.example' });
    useWorkspaceStore.getState().upsertRemote('Home', 'https://home.example');
    renderWizard(undefined, '?step=obsidian');

    expect(await screen.findByText('Connect your Obsidian vault')).toBeInTheDocument();
  });

  it('requires a new PIN before opening the local server to phones', async () => {
    renderWizard();
    await runLocalServer();
    next();
    skipStep();
    skipStep();

    expect(await screen.findByText('Phones need local network access')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pairing QR' })).not.toBeInTheDocument();
    const allow = screen.getByRole('button', { name: 'Allow local network access' });
    expect(allow).toBeDisabled();

    fireEvent.change(screen.getByLabelText('New PIN for this server'), {
      target: { value: '123' },
    });
    expect(allow).toBeDisabled();
    fireEvent.change(screen.getByLabelText('New PIN for this server'), {
      target: { value: '48291375' },
    });
    fireEvent.click(allow);

    fireEvent.click(await screen.findByRole('button', { name: 'Pairing QR' }));
    expect(serverMocks.updateConfig).toHaveBeenCalledWith({ pin: '48291375', lanAccess: true });
    expect(screen.getByText('Phone paired')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  it('finishes once and opens the app', async () => {
    serverMocks.selectFolder.mockResolvedValue('/home/me/Vault');
    renderWizard();
    await runLocalServer();
    next();
    skipStep();
    fireEvent.click(await screen.findByRole('button', { name: 'Choose vault folder' }));
    await screen.findByText('Vault connected');
    next();
    skipStep();

    const summary = await screen.findByText('ClawChat is ready');
    const card = summary.closest('.cc-onboarding__card') as HTMLElement;
    expect(within(card).getByText('This computer')).toBeInTheDocument();
    expect(within(card).getByText('Not tested')).toBeInTheDocument();
    expect(within(card).getByText('/home/me/Vault')).toBeInTheDocument();
    expect(within(card).getByText('Not paired')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open ClawChat' }));

    expect(useFirstRunStore.getState().outcome).toBe('completed');
    expect(JSON.parse(localStorage.getItem('first-run-setup')!).state.outcome).toBe('completed');
    expect(routerMocks.navigate).toHaveBeenCalledWith('/', { replace: true });
  });

  it('can be skipped from any step', async () => {
    renderWizard();

    fireEvent.click(await screen.findByRole('button', { name: 'Skip setup' }));

    expect(useFirstRunStore.getState().outcome).toBe('skipped');
    expect(routerMocks.navigate).toHaveBeenCalledWith('/', { replace: true });
  });

  it('closes a wizard reopened from settings without forgetting it was finished', async () => {
    useFirstRunStore.setState({ outcome: 'completed' });
    renderWizard({ returnTo: '/settings/app' });

    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));

    expect(useFirstRunStore.getState().outcome).toBe('completed');
    expect(routerMocks.navigate).toHaveBeenCalledWith('/settings/app', { replace: true });
  });
});
