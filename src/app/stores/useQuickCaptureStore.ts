import { create } from 'zustand';

interface QuickCaptureState {
  isOpen: boolean;
  defaultParentId: string | undefined;
  open: (opts?: { defaultParentId?: string }) => void;
  close: () => void;
}

/** The ⌘N dialog: the Inbox input, opened from any screen. */
export const useQuickCaptureStore = create<QuickCaptureState>()((set) => ({
  isOpen: false,
  defaultParentId: undefined,

  open: (opts) => set({ isOpen: true, defaultParentId: opts?.defaultParentId }),

  close: () => set({ isOpen: false, defaultParentId: undefined }),
}));
