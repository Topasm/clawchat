import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Whether this profile has been through the desktop setup wizard.
 *
 * A fresh desktop install used to open on a stopped local server with no
 * guidance at all. The wizard runs until the user either finishes it or
 * skips it; after that it only opens again from Settings.
 */
export type FirstRunOutcome = 'completed' | 'skipped';

interface FirstRunState {
  outcome: FirstRunOutcome | null;
  finishedAt: string | null;
  /**
   * Record that setup is under way, so an app closed halfway through brings
   * the wizard back instead of reading the keys that run left behind as an
   * older, already set up profile.
   */
  begin: () => void;
  finish: (outcome: FirstRunOutcome) => void;
}

export const FIRST_RUN_STORAGE_KEY = 'first-run-setup';

/**
 * Keys an earlier launch leaves behind. A profile that already has any of
 * them was set up before the wizard existed, so it must not be sent through
 * first-run setup on upgrade.
 */
const EXISTING_PROFILE_KEYS = [
  'cc-onboarding-complete',
  'workspace-connections',
  'auth-storage',
  'settings-storage',
];

export function hasExistingProfile(storage: Pick<Storage, 'getItem'> | null): boolean {
  if (!storage) return false;
  try {
    return EXISTING_PROFILE_KEYS.some((key) => storage.getItem(key) !== null);
  } catch {
    return false;
  }
}

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function initialState(): Pick<FirstRunState, 'outcome' | 'finishedAt'> {
  return hasExistingProfile(browserStorage())
    ? { outcome: 'completed', finishedAt: null }
    : { outcome: null, finishedAt: null };
}

export const useFirstRunStore = create<FirstRunState>()(
  persist(
    (set, get) => ({
      ...initialState(),
      begin: () => set({ outcome: get().outcome }),
      finish: (outcome) => set({ outcome, finishedAt: new Date().toISOString() }),
    }),
    {
      name: FIRST_RUN_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ outcome: state.outcome, finishedAt: state.finishedAt }),
    },
  ),
);
