import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ServerStatus } from '../../platform';

const serverMocks = vi.hoisted(() => ({
  getAppMode: vi.fn(),
  getStatus: vi.fn(),
  getConfig: vi.fn(),
  setAppMode: vi.fn(),
  onStatusChange: vi.fn(),
}));
const loggerMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));
const authMocks = vi.hoisted(() => ({
  state: { token: null as string | null, login: vi.fn() },
}));

vi.mock('../../platform', () => ({ platformApi: { server: serverMocks } }));
vi.mock('../../types/platform', () => ({ IS_DESKTOP: true }));
vi.mock('../../services/logger', () => ({ logger: loggerMocks, default: loggerMocks }));
vi.mock('../useAuthStore', () => ({
  useAuthStore: { getState: () => authMocks.state },
}));

const { useHostSessionStore, classifyLoginFailure } = await import('../useHostSessionStore');

function status(partial: Partial<ServerStatus> = {}): ServerStatus {
  return { state: 'running', port: 8000, ...partial };
}

let statusListener: ((next: ServerStatus) => void) | null = null;
const unsubscribe = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  statusListener = null;
  authMocks.state = { token: null, login: vi.fn().mockResolvedValue(undefined) };
  serverMocks.onStatusChange.mockImplementation((callback: (next: ServerStatus) => void) => {
    statusListener = callback;
    return unsubscribe;
  });
  serverMocks.getAppMode.mockResolvedValue('host');
  serverMocks.getConfig.mockResolvedValue({
    appMode: 'host',
    port: 8123,
    pin: '123456',
    obsidianVaultPath: '',
    hostServerUrl: '',
    autoStartHost: false,
  });
  serverMocks.getStatus.mockResolvedValue(status());
  useHostSessionStore.getState().reset();
});

afterEach(() => {
  useHostSessionStore.getState().reset();
  vi.useRealTimers();
});

describe('host session auto-login', () => {
  it('signs in against the local server once it is running', async () => {
    await useHostSessionStore.getState().start();

    expect(authMocks.state.login).toHaveBeenCalledWith('http://localhost:8123', '123456');
    expect(useHostSessionStore.getState().phase).toBe('connected');
    expect(useHostSessionStore.getState().isHostMode).toBe(true);
  });

  it('reports a booting sidecar instead of signing in early', async () => {
    serverMocks.getStatus.mockResolvedValue(status({ state: 'starting' }));

    await useHostSessionStore.getState().start();

    expect(useHostSessionStore.getState().phase).toBe('starting');
    expect(authMocks.state.login).not.toHaveBeenCalled();
  });

  it('keeps watching a stopped sidecar so a later start still signs in', async () => {
    serverMocks.getStatus.mockResolvedValue(status({ state: 'stopped' }));

    await useHostSessionStore.getState().start();

    // The old hook returned silently here, leaving the user on a PIN form that
    // could never succeed and with no subscription to recover from.
    expect(useHostSessionStore.getState().phase).toBe('blocked');
    expect(serverMocks.onStatusChange).toHaveBeenCalledTimes(1);

    statusListener?.(status({ state: 'running' }));
    await vi.waitFor(() => expect(authMocks.state.login).toHaveBeenCalledTimes(1));
    expect(useHostSessionStore.getState().phase).toBe('connected');
  });

  it('keeps the reason a blocked sidecar reported', async () => {
    serverMocks.getStatus.mockResolvedValue(
      status({
        state: 'error',
        error: 'legacy data import failed; host startup blocked: db is corrupt',
      }),
    );

    await useHostSessionStore.getState().start();

    expect(useHostSessionStore.getState().phase).toBe('blocked');
    expect(useHostSessionStore.getState().status?.error).toBe(
      'legacy data import failed; host startup blocked: db is corrupt',
    );
    expect(authMocks.state.login).not.toHaveBeenCalled();
  });

  it('stays out of the way in client mode', async () => {
    serverMocks.getAppMode.mockResolvedValue('client');

    await useHostSessionStore.getState().start();

    expect(useHostSessionStore.getState().phase).toBe('idle');
    expect(useHostSessionStore.getState().isHostMode).toBe(false);
    expect(serverMocks.onStatusChange).not.toHaveBeenCalled();
    expect(authMocks.state.login).not.toHaveBeenCalled();
  });

  it('stays idle when there is no native server bridge', async () => {
    serverMocks.getAppMode.mockRejectedValue(
      new Error('App mode is unavailable in the web runtime'),
    );

    await useHostSessionStore.getState().start();

    expect(useHostSessionStore.getState().phase).toBe('idle');
    expect(authMocks.state.login).not.toHaveBeenCalled();
  });

  it('runs the handshake once no matter how many callers start it', async () => {
    await Promise.all([
      useHostSessionStore.getState().start(),
      useHostSessionStore.getState().start(),
    ]);
    await useHostSessionStore.getState().start();

    expect(serverMocks.onStatusChange).toHaveBeenCalledTimes(1);
    expect(authMocks.state.login).toHaveBeenCalledTimes(1);
  });

  it('does not sign in twice when a status event lands mid-login', async () => {
    await useHostSessionStore.getState().start();
    authMocks.state.token = 'session-token';

    statusListener?.(status({ state: 'running' }));

    expect(authMocks.state.login).toHaveBeenCalledTimes(1);
  });
});

describe('host session failure reporting', () => {
  it('tells an unreachable server apart from a refused PIN', async () => {
    authMocks.state.login = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await useHostSessionStore.getState().start();

    expect(useHostSessionStore.getState().failure).toEqual({
      kind: 'unreachable',
      message: 'Failed to fetch',
    });
    expect(loggerMocks.error).toHaveBeenCalledWith(
      'Desktop auto-login failed (unreachable)',
      expect.anything(),
    );

    useHostSessionStore.getState().reset();
    vi.clearAllMocks();
    authMocks.state = {
      token: null,
      login: vi.fn().mockRejectedValue(new Error('Login failed. Check your server URL and PIN.')),
    };
    await useHostSessionStore.getState().start();

    expect(useHostSessionStore.getState().failure?.kind).toBe('rejected');
    expect(loggerMocks.error).toHaveBeenCalledWith(
      'Desktop auto-login failed (rejected)',
      expect.anything(),
    );
  });

  it('classifies transport and credential errors', () => {
    expect(classifyLoginFailure(new TypeError('Load failed')).kind).toBe('unreachable');
    expect(classifyLoginFailure(new Error('NetworkError when attempting to fetch')).kind).toBe(
      'unreachable',
    );
    expect(classifyLoginFailure(new Error('Invalid PIN')).kind).toBe('rejected');
    expect(classifyLoginFailure(new Error('boom')).kind).toBe('unknown');
  });
});

describe('host startup retry', () => {
  it('asks the shell to host, then signs in', async () => {
    serverMocks.setAppMode.mockResolvedValue({ port: 8123, pin: '123456' });

    await useHostSessionStore.getState().retryHostStartup();

    expect(serverMocks.setAppMode).toHaveBeenCalledWith('host');
    expect(authMocks.state.login).toHaveBeenCalledWith('http://localhost:8123', '123456');
    expect(useHostSessionStore.getState().phase).toBe('connected');
  });

  it('waits for a booting server rather than logging in against a closed port', async () => {
    vi.useFakeTimers();
    serverMocks.setAppMode.mockResolvedValue({ port: 8123, pin: '123456' });
    serverMocks.getStatus
      .mockResolvedValueOnce(status({ state: 'starting' }))
      .mockResolvedValueOnce(status({ state: 'starting' }))
      .mockResolvedValue(status({ state: 'running' }));

    const retry = useHostSessionStore.getState().retryHostStartup();
    await vi.advanceTimersByTimeAsync(2000);
    await retry;

    expect(serverMocks.getStatus.mock.calls.length).toBeGreaterThan(1);
    expect(authMocks.state.login).toHaveBeenCalledTimes(1);
  });

  it('surfaces a shell that refuses to switch into host mode', async () => {
    serverMocks.setAppMode.mockRejectedValue(new Error('packaged server binary is missing'));

    await useHostSessionStore.getState().retryHostStartup();

    expect(useHostSessionStore.getState().phase).toBe('blocked');
    expect(useHostSessionStore.getState().failure?.message).toBe(
      'packaged server binary is missing',
    );
  });
});
