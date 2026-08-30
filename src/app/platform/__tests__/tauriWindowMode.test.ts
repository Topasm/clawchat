import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TAURI_COMMANDS } from '../tauriCommands';

const invoke = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke }));

const { tauriPlatformApi } = await import('../tauriPlatformApi');

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
});

describe('Tauri workspace window mode', () => {
  it.each(['simple', 'expanded'] as const)(
    'delegates %s sizing to the native shell',
    async (mode) => {
      await tauriPlatformApi.appWindow.setWorkspaceViewMode(mode);

      expect(invoke).toHaveBeenCalledWith(TAURI_COMMANDS.appSetWorkspaceViewMode, { mode });
    },
  );
});
