import type { Toast as ToastData } from '../../stores/useToastStore';
import { useToastStore } from '../../stores/useToastStore';
import { CheckCircleIcon, CloseIcon, InfoIcon, WarningIcon } from './Icons';

function ToastTypeIcon({ type }: { type: ToastData['type'] }) {
  if (type === 'success') return <CheckCircleIcon size={16} />;
  if (type === 'error') return <CloseIcon size={16} />;
  if (type === 'warning') return <WarningIcon size={16} />;
  return <InfoIcon size={16} />;
}

export default function Toast({ toast }: { toast: ToastData }) {
  const removeToast = useToastStore((s) => s.removeToast);

  return (
    <div className={`cc-toast cc-toast--${toast.type}`} role="alert">
      <span className="cc-toast__icon"><ToastTypeIcon type={toast.type} /></span>
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
        <CloseIcon size={14} />
      </button>
    </div>
  );
}
