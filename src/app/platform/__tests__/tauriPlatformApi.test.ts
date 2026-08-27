import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { tauriPlatformApi } from '../tauriPlatformApi';
import { TAURI_COMMANDS } from '../tauriCommands';

afterEach(() => {
  clearMocks();
});

describe('tauriPlatformApi', () => {
  it('identifies itself as a native Tauri desktop runtime', () => {
    expect(tauriPlatformApi.runtime).toMatchObject({
      kind: 'tauri',
      isDesktop: true,
      appVersion: '0.1.0',
    });
  });

  it('invokes stable server command names with typed arguments', async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    mockIPC((command, args) => {
      calls.push({ command, args });
      if (command === TAURI_COMMANDS.serverGetStatus) {
        return { state: 'stopped', port: 8000 };
      }
      if (command === TAURI_COMMANDS.serverUpdateConfig) {
        return { appMode: 'client', port: 8123 };
      }
      return null;
    });

    await expect(tauriPlatformApi.server.getStatus()).resolves.toMatchObject({
      state: 'stopped',
      port: 8000,
    });
    await tauriPlatformApi.server.updateConfig({ port: 8123 });

    expect(calls).toEqual([
      { command: TAURI_COMMANDS.serverGetStatus, args: {} },
      { command: TAURI_COMMANDS.serverUpdateConfig, args: { updates: { port: 8123 } } },
    ]);
  });

  it('routes notification payloads through Rust', async () => {
    const handler = vi.fn();
    mockIPC((command, args) => handler(command, args));

    await tauriPlatformApi.notifications.show('Reminder', 'Review PR', {
      itemType: 'todo',
      itemId: 'task-1',
    });

    expect(handler).toHaveBeenCalledWith(TAURI_COMMANDS.appShowNotification, {
      title: 'Reminder',
      body: 'Review PR',
      options: { itemType: 'todo', itemId: 'task-1' },
    });
  });

  it('routes secure storage operations through Rust commands', async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    mockIPC((command, args) => {
      calls.push({ command, args });
      return command === TAURI_COMMANDS.secureStorageGet ? 'encrypted-value' : null;
    });

    await expect(tauriPlatformApi.secureStorage!.get('auth-storage')).resolves.toBe('encrypted-value');
    await tauriPlatformApi.secureStorage!.set('auth-storage', 'next');
    await tauriPlatformApi.secureStorage!.remove('auth-storage');

    expect(calls).toEqual([
      { command: TAURI_COMMANDS.secureStorageGet, args: { key: 'auth-storage' } },
      {
        command: TAURI_COMMANDS.secureStorageSet,
        args: { key: 'auth-storage', value: 'next' },
      },
      { command: TAURI_COMMANDS.secureStorageRemove, args: { key: 'auth-storage' } },
    ]);
  });

  it('routes the signed updater lifecycle through Rust commands', async () => {
    const calls: string[] = [];
    mockIPC((command) => {
      calls.push(command);
      return null;
    });

    await tauriPlatformApi.updater.checkForUpdates();
    await tauriPlatformApi.updater.downloadUpdate();
    await tauriPlatformApi.updater.installUpdate();

    expect(calls).toEqual([
      TAURI_COMMANDS.updaterCheck,
      TAURI_COMMANDS.updaterDownload,
      TAURI_COMMANDS.updaterInstall,
    ]);
  });
});
