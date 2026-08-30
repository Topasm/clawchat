import { beforeEach, describe, expect, it, vi } from 'vitest';

const server = vi.hoisted(() => ({
  getConfig: vi.fn(),
  getStatus: vi.fn(),
  updateConfig: vi.fn(),
  setAppMode: vi.fn(),
  onStatusChange: vi.fn(() => () => {}),
  onRuntimeChange: vi.fn(() => () => {}),
}));

vi.mock('../../platform', () => ({
  platformApi: {
    runtime: { isDesktop: true },
    server,
  },
}));
vi.mock('../../services/logger', () => ({
  logger: { error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const { useWorkspaceRuntimeStore } = await import('../useWorkspaceRuntimeStore');

const config = {
  appMode: 'host' as const,
  localServerEnabled: true,
  keepRunningInTray: true,
  port: 8000,
  pinConfigured: true,
  defaultPinInUse: false,
  obsidianVaultPath: '',
  hostServerUrl: '',
  autoStartHost: false,
  lanAccess: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceRuntimeStore.getState().reset();
  server.getConfig.mockResolvedValue(config);
  server.getStatus.mockResolvedValue({ state: 'running', port: 8000 });
});

describe('useWorkspaceRuntimeStore', () => {
  it('publishes one shared ready snapshot', async () => {
    await useWorkspaceRuntimeStore.getState().initialize();

    expect(useWorkspaceRuntimeStore.getState()).toMatchObject({
      bootstrapPhase: 'ready',
      config,
      localServerStatus: { state: 'running', port: 8000 },
      error: null,
    });
    expect(server.onStatusChange).toHaveBeenCalledTimes(1);
    expect(server.onRuntimeChange).toHaveBeenCalledTimes(1);
  });

  it('does not report success when native saved a setting but restart failed', async () => {
    server.updateConfig.mockResolvedValue({
      config,
      previousStatus: { state: 'running', port: 8000 },
      status: { state: 'error', port: 8000, error: 'address already in use' },
      applied: false,
      restartRequired: true,
    });

    await expect(
      useWorkspaceRuntimeStore.getState().updateLocalServerPolicy({ port: 8000 }),
    ).rejects.toThrow('address already in use');
    expect(useWorkspaceRuntimeStore.getState()).toMatchObject({
      bootstrapPhase: 'action_required',
      error: 'address already in use',
      transition: null,
    });
  });

  it('ends native bridge failures instead of loading forever', async () => {
    server.getConfig.mockRejectedValue(new Error('bridge unavailable'));

    await useWorkspaceRuntimeStore.getState().initialize();

    expect(useWorkspaceRuntimeStore.getState()).toMatchObject({
      bootstrapPhase: 'action_required',
      error: 'bridge unavailable',
    });
  });
});
