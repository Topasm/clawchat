import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FIRST_RUN_STORAGE_KEY, hasExistingProfile, useFirstRunStore } from '../useFirstRunStore';

function stored(): { outcome: string | null; finishedAt: string | null } | null {
  const raw = localStorage.getItem(FIRST_RUN_STORAGE_KEY);
  return raw ? JSON.parse(raw).state : null;
}

beforeEach(() => {
  localStorage.clear();
  useFirstRunStore.setState({ outcome: null, finishedAt: null });
  localStorage.clear();
});

describe('hasExistingProfile', () => {
  it('treats an empty profile as new', () => {
    expect(hasExistingProfile(localStorage)).toBe(false);
    expect(hasExistingProfile(null)).toBe(false);
  });

  it.each(['cc-onboarding-complete', 'workspace-connections', 'auth-storage', 'settings-storage'])(
    'treats a profile with %s as already set up',
    (key) => {
      localStorage.setItem(key, '{}');
      expect(hasExistingProfile(localStorage)).toBe(true);
    },
  );

  it('falls back to a new profile when storage cannot be read', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(hasExistingProfile(broken)).toBe(false);
  });
});

describe('useFirstRunStore', () => {
  it('records that setup started, so a half-finished run comes back', () => {
    useFirstRunStore.getState().begin();

    expect(stored()).toEqual({ outcome: null, finishedAt: null });
  });

  it.each(['completed', 'skipped'] as const)('persists a %s setup', (outcome) => {
    useFirstRunStore.getState().finish(outcome);

    expect(useFirstRunStore.getState().outcome).toBe(outcome);
    expect(stored()?.outcome).toBe(outcome);
    expect(stored()?.finishedAt).toEqual(expect.any(String));
  });

  it('restores the outcome on the next launch', async () => {
    localStorage.setItem(
      FIRST_RUN_STORAGE_KEY,
      JSON.stringify({
        state: { outcome: 'skipped', finishedAt: '2026-10-15T00:00:00Z' },
        version: 1,
      }),
    );

    await useFirstRunStore.persist.rehydrate();

    expect(useFirstRunStore.getState().outcome).toBe('skipped');
  });

  async function freshLaunch() {
    vi.resetModules();
    const module = await import('../useFirstRunStore');
    return module.useFirstRunStore.getState().outcome;
  }

  it('starts setup on a fresh profile', async () => {
    expect(await freshLaunch()).toBeNull();
  });

  it('does not send an upgraded profile through setup', async () => {
    localStorage.setItem('workspace-connections', '{}');

    expect(await freshLaunch()).toBe('completed');
  });

  it('keeps an unfinished setup pending across launches', async () => {
    useFirstRunStore.getState().begin();
    // The interrupted run left other keys behind; they must not count as an
    // older profile now that the wizard has its own record.
    localStorage.setItem('workspace-connections', '{}');

    expect(await freshLaunch()).toBeNull();
  });
});
