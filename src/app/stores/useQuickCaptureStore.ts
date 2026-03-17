import { create } from 'zustand';

interface QuickCaptureState {
  isOpen: boolean;
  placeholder: string;
  defaultParentId: string | undefined;
  open: (opts?: { placeholder?: string; defaultParentId?: string }) => void;
  close: () => void;
}

export const useQuickCaptureStore = create<QuickCaptureState>()((set) => ({
  isOpen: false,
  placeholder: '',
  defaultParentId: undefined,

  open: (opts) =>
    set({
      isOpen: true,
      placeholder: opts?.placeholder ?? '',
      defaultParentId: opts?.defaultParentId,
    }),

  close: () =>
    set({
      isOpen: false,
      placeholder: '',
      defaultParentId: undefined,
    }),
}));
