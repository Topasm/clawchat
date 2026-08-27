import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { UpdateDownloadProgress, UpdateInfo } from '../platform/nativePlatformTypes';

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'restarting'
  | 'error';

export type UpdateErrorAction = 'check' | 'download' | 'install';

export type UpdateLifecyclePatch = Partial<Pick<UpdateStore,
  'status' | 'info' | 'progress' | 'error' | 'errorAction'
>>;

interface UpdateStore {
  status: UpdateStatus;
  info: UpdateInfo | null;
  progress: UpdateDownloadProgress | null;
  error: string | null;
  errorAction: UpdateErrorAction | null;
  automaticChecksEnabled: boolean;
  dismissedVersion: string | null;
  setLifecycle: (patch: UpdateLifecyclePatch) => void;
  setAutomaticChecksEnabled: (enabled: boolean) => void;
  dismissVersion: (version: string | null) => void;
}

const initialLifecycle = {
  status: 'idle' as UpdateStatus,
  info: null,
  progress: null,
  error: null,
  errorAction: null,
};

export const useUpdateStore = create<UpdateStore>()(
  persist(
    (set) => ({
      ...initialLifecycle,
      automaticChecksEnabled: true,
      dismissedVersion: null,
      setLifecycle: (patch) => set(patch),
      setAutomaticChecksEnabled: (automaticChecksEnabled) => set({ automaticChecksEnabled }),
      dismissVersion: (dismissedVersion) => set({ dismissedVersion }),
    }),
    {
      name: 'clawchat-update-preferences',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        automaticChecksEnabled: state.automaticChecksEnabled,
        dismissedVersion: state.dismissedVersion,
      }),
    },
  ),
);

export function resetUpdateLifecycleState() {
  useUpdateStore.setState(initialLifecycle);
}
