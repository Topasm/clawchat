import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  action?: ToastAction;
  /** A second, quieter choice after the action ("Change · Undo"). */
  secondaryAction?: ToastAction;
}

interface AddToastOptions {
  action?: ToastAction;
  secondaryAction?: ToastAction;
  duration?: number;
}

interface ToastState {
  toasts: Toast[];
  addToast: (type: ToastType, message: string, options?: AddToastOptions) => string;
  removeToast: (id: string) => void;
}

let nextId = 0;

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],

  addToast: (type, message, options) => {
    const id = `toast-${++nextId}`;
    const duration = options?.duration ?? 3500;
    set((state) => ({
      toasts: [
        ...state.toasts,
        {
          id,
          type,
          message,
          action: options?.action,
          secondaryAction: options?.secondaryAction,
        },
      ],
    }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, duration);
    return id;
  },

  removeToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
