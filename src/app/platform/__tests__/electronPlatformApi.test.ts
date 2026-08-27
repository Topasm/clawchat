import { describe, expect, it, vi } from 'vitest';
import type { ElectronAPI } from '../../types/electron';
import { createElectronPlatformApi } from '../electronPlatformApi';
import type { AppMode, ServerConfig, ServerStatus } from '../nativePlatformTypes';

function createBridge(): ElectronAPI {
  return {
    platform: 'linux',
    appVersion: '0.1.0',
    send: vi.fn(),
    on: vi.fn(() => () => {}),
    showNotification: vi.fn(),
    setBadgeCount: vi.fn(),
    updater: {
      checkForUpdates: vi.fn(async () => null),
      downloadUpdate: vi.fn(async () => {}),
      installUpdate: vi.fn(async () => {}),
      onUpdateAvailable: vi.fn(() => () => {}),
      onUpdateNotAvailable: vi.fn(() => () => {}),
      onDownloadProgress: vi.fn(() => () => {}),
      onUpdateDownloaded: vi.fn(() => () => {}),
    },
    server: {
      getStatus: vi.fn(async (): Promise<ServerStatus> => ({ state: 'running', port: 8000 })),
      getConfig: vi.fn(async (): Promise<ServerConfig> => ({
        appMode: 'host',
        port: 8000,
        pin: '123456',
        obsidianVaultPath: '',
        hostServerUrl: '',
        autoStartHost: true,
      })),
      getNetworkInfo: vi.fn(async () => ({ addresses: [] })),
      updateConfig: vi.fn(async (updates) => ({
        appMode: 'host',
        port: 8000,
        pin: '123456',
        obsidianVaultPath: '',
        hostServerUrl: '',
        autoStartHost: true,
        ...updates,
      })),
      selectFolder: vi.fn(async () => null),
      openObsidianVault: vi.fn(async () => {}),
      setAppMode: vi.fn(async (appMode) => ({
        appMode,
        port: 8000,
        pin: '123456',
        obsidianVaultPath: '',
        hostServerUrl: '',
        autoStartHost: true,
      })),
      getAppMode: vi.fn(async (): Promise<AppMode> => 'host'),
      onStatusChange: vi.fn(() => () => {}),
    },
  };
}

describe('createElectronPlatformApi', () => {
  it('describes the Electron runtime without leaking the preload bridge', () => {
    const api = createElectronPlatformApi(createBridge());

    expect(api.runtime).toEqual({
      kind: 'electron',
      os: 'linux',
      appVersion: '0.1.0',
      isDesktop: true,
    });
  });

  it('forwards native events, notifications, and server calls', async () => {
    const bridge = createBridge();
    const api = createElectronPlatformApi(bridge);
    const listener = vi.fn();

    api.events.on('open-quick-capture', listener);
    await api.notifications.show('Reminder', 'Write tests', { itemType: 'todo', itemId: '1' });
    await api.notifications.setBadgeCount(3);
    await api.server.updateConfig({ port: 8123 });

    expect(bridge.on).toHaveBeenCalledWith('open-quick-capture', listener);
    expect(bridge.showNotification).toHaveBeenCalledWith(
      'Reminder',
      'Write tests',
      { itemType: 'todo', itemId: '1' },
    );
    expect(bridge.setBadgeCount).toHaveBeenCalledWith(3);
    expect(bridge.server.updateConfig).toHaveBeenCalledWith({ port: 8123 });
  });

  it('adapts an optional Electron secure store to the neutral contract', async () => {
    const bridge = createBridge();
    bridge.secureStore = {
      get: vi.fn(async () => 'secret'),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    };
    const api = createElectronPlatformApi(bridge);

    await expect(api.secureStorage!.get('token')).resolves.toBe('secret');
    await api.secureStorage!.set('token', 'next');
    await api.secureStorage!.remove('token');

    expect(bridge.secureStore.set).toHaveBeenCalledWith('token', 'next');
    expect(bridge.secureStore.delete).toHaveBeenCalledWith('token');
  });

  it('reports secure storage as unavailable when the bridge does not expose it', () => {
    expect(createElectronPlatformApi(createBridge()).secureStorage).toBeNull();
  });
});
