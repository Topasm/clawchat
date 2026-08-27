import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const updaterMock = vi.hoisted(() => ({
  checkForUpdates: vi.fn<() => Promise<{ version: string; releaseNotes?: string } | null>>(),
  downloadUpdate: vi.fn<() => Promise<void>>(),
  installUpdate: vi.fn<() => Promise<void>>(),
  availableListener: null as ((info: { version: string; releaseNotes?: string }) => void) | null,
  notAvailableListener: null as (() => void) | null,
  progressListener: null as ((progress: { downloadedBytes: number; totalBytes?: number; percent?: number }) => void) | null,
  downloadedListener: null as (() => void) | null,
}));

vi.mock('../platform', () => ({
  platformApi: {
    runtime: { kind: 'tauri', os: 'desktop', appVersion: '0.1.0', isDesktop: true },
    updater: {
      checkForUpdates: updaterMock.checkForUpdates,
      downloadUpdate: updaterMock.downloadUpdate,
      installUpdate: updaterMock.installUpdate,
      onUpdateAvailable: (callback: typeof updaterMock.availableListener) => {
        updaterMock.availableListener = callback;
        return () => { updaterMock.availableListener = null; };
      },
      onUpdateNotAvailable: (callback: typeof updaterMock.notAvailableListener) => {
        updaterMock.notAvailableListener = callback;
        return () => { updaterMock.notAvailableListener = null; };
      },
      onDownloadProgress: (callback: typeof updaterMock.progressListener) => {
        updaterMock.progressListener = callback;
        return () => { updaterMock.progressListener = null; };
      },
      onUpdateDownloaded: (callback: typeof updaterMock.downloadedListener) => {
        updaterMock.downloadedListener = callback;
        return () => { updaterMock.downloadedListener = null; };
      },
    },
  },
}));

import {
  checkForAppUpdate,
  dismissAppUpdate,
  downloadAppUpdate,
  initializeUpdateLifecycle,
  resetUpdateLifecycleForTests,
} from './updateLifecycle';
import { useUpdateStore } from '../stores/useUpdateStore';

describe('updateLifecycle', () => {
  beforeEach(() => {
    resetUpdateLifecycleForTests();
    updaterMock.checkForUpdates.mockReset().mockResolvedValue(null);
    updaterMock.downloadUpdate.mockReset().mockResolvedValue();
    updaterMock.installUpdate.mockReset().mockResolvedValue();
    useUpdateStore.getState().setAutomaticChecksEnabled(false);
  });

  afterEach(() => {
    resetUpdateLifecycleForTests();
  });

  it('reports an interactive check result without relying on an event race', async () => {
    await checkForAppUpdate(true);

    expect(updaterMock.checkForUpdates).toHaveBeenCalledOnce();
    expect(useUpdateStore.getState().status).toBe('up-to-date');
  });

  it('upgrades an in-flight automatic check when the user checks manually', async () => {
    let resolveCheck: (value: null) => void = () => {};
    updaterMock.checkForUpdates.mockReturnValue(new Promise((resolve) => {
      resolveCheck = resolve;
    }));

    const automaticRequest = checkForAppUpdate(false);
    const manualRequest = checkForAppUpdate(true);
    expect(updaterMock.checkForUpdates).toHaveBeenCalledOnce();
    expect(useUpdateStore.getState().status).toBe('checking');

    resolveCheck(null);
    await Promise.all([automaticRequest, manualRequest]);
    expect(useUpdateStore.getState().status).toBe('up-to-date');
  });

  it('tracks download progress and marks the staged update ready', async () => {
    initializeUpdateLifecycle();
    updaterMock.checkForUpdates.mockResolvedValue({
      version: '0.2.0',
      releaseNotes: 'Faster startup',
    });
    updaterMock.downloadUpdate.mockImplementation(async () => {
      updaterMock.progressListener?.({
        downloadedBytes: 50,
        totalBytes: 100,
        percent: 50,
      });
      updaterMock.downloadedListener?.();
    });

    await checkForAppUpdate(true);
    expect(useUpdateStore.getState()).toMatchObject({
      status: 'available',
      info: { version: '0.2.0' },
    });

    await downloadAppUpdate();
    expect(updaterMock.downloadUpdate).toHaveBeenCalledOnce();
    expect(useUpdateStore.getState().status).toBe('ready');
  });

  it('remembers a dismissed release during silent checks but shows it on manual checks', async () => {
    initializeUpdateLifecycle();
    const update = { version: '0.2.0' };
    updaterMock.checkForUpdates.mockResolvedValue(update);

    await checkForAppUpdate(true);
    dismissAppUpdate();
    expect(useUpdateStore.getState().status).toBe('idle');

    updaterMock.availableListener?.(update);
    expect(useUpdateStore.getState().status).toBe('idle');

    await checkForAppUpdate(true);
    expect(useUpdateStore.getState().status).toBe('available');
  });
});
