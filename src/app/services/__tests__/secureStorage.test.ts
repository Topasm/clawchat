import { beforeEach, describe, expect, it, vi } from 'vitest';

const vault = vi.hoisted(() => {
  const items = new Map<string, string>();
  const state = {
    refuseWrites: false,
    writePlan: [] as Array<{ delayMs: number; refuse: boolean }>,
  };
  return {
    items,
    state,
    api: {
      get: async (key: string) => items.get(key) ?? null,
      set: async (key: string, value: string) => {
        const { delayMs, refuse } = state.writePlan.shift() ?? {
          delayMs: 0,
          refuse: state.refuseWrites,
        };
        if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
        if (refuse) throw new Error('errSecInteractionNotAllowed');
        items.set(key, value);
      },
      remove: async (key: string) => {
        items.delete(key);
      },
    },
  };
});

vi.mock('../../platform', () => ({
  platformApi: {
    runtime: { kind: 'tauri', isDesktop: true, os: 'macos' },
    secureStorage: vault.api,
  },
}));

import { secureStorage } from '../platform';

const KEY = 'auth-storage';

beforeEach(() => {
  localStorage.clear();
  vault.items.clear();
  vault.state.refuseWrites = false;
  vault.state.writePlan = [];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('secureStorage', () => {
  it('keeps credentials in the OS vault when it accepts them', async () => {
    await secureStorage.set(KEY, 'refresh-1');

    expect(vault.items.get(KEY)).toBe('refresh-1');
    expect(localStorage.getItem(KEY)).toBeNull();
    await expect(secureStorage.get(KEY)).resolves.toBe('refresh-1');
  });

  it('returns the newer token when the vault still holds one it refused to replace', async () => {
    // The previous build stored refresh-1; after an update the vault still
    // answers reads but refuses writes, so the rotated token lands locally.
    vault.items.set(KEY, 'refresh-1');
    vault.state.refuseWrites = true;

    await secureStorage.set(KEY, 'refresh-2');

    expect(vault.items.get(KEY)).toBe('refresh-1');
    await expect(secureStorage.get(KEY)).resolves.toBe('refresh-2');
  });

  it('moves the local copy into the vault once the vault accepts writes again', async () => {
    vault.items.set(KEY, 'refresh-1');
    localStorage.setItem(KEY, 'refresh-2');

    await expect(secureStorage.get(KEY)).resolves.toBe('refresh-2');

    expect(vault.items.get(KEY)).toBe('refresh-2');
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('applies writes to one key in the order they were made', async () => {
    // The first write is slow and refused, the second fast and accepted. Run
    // concurrently, the refused write would land locally after the accepted
    // one and shadow it with the older token.
    vault.state.writePlan = [
      { delayMs: 20, refuse: true },
      { delayMs: 0, refuse: false },
    ];

    await Promise.all([secureStorage.set(KEY, 'refresh-1'), secureStorage.set(KEY, 'refresh-2')]);

    await expect(secureStorage.get(KEY)).resolves.toBe('refresh-2');
  });

  it('removes the credential from both stores', async () => {
    vault.items.set(KEY, 'refresh-1');
    localStorage.setItem(KEY, 'refresh-2');

    await secureStorage.remove(KEY);

    await expect(secureStorage.get(KEY)).resolves.toBeNull();
  });
});
