import type { Toast as ToastData } from '../../stores/useToastStore';
import { useToastStore } from '../../stores/useToastStore';

const icons: Record<ToastData['type'], string> = {
  success: '✓',
  error: '✕',
  info: 'ℹ',
  warning: '⚠',
};

export default function Toast({ toast }: { toast: ToastData }) {
  const removeToast = useToastStore((s) => s.removeToast);

  return (
    <div className={`cc-toast cc-toast--${toast.type}`} role="alert">
      <span className="cc-toast__icon">{icons[toast.type]}</span>
      <span className="cc-toast__message">{toast.message}</span>
      {toast.action && (
        <button
          className="cc-toast__action"
          onClick={() => {
            toast.action!.onClick();
            removeToast(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        className="cc-toast__close"
        onClick={() => removeToast(toast.id)}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
