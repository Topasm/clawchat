import Dialog from './Dialog';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
}

export default function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const handleCancel = () => {
    onCancel?.();
    onOpenChange(false);
  };

  const handleConfirm = () => {
    onConfirm();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title}>
      <p className="cc-dialog__description">{description}</p>
      <div className="cc-dialog__actions">
        <button className="cc-btn cc-btn--secondary" onClick={handleCancel}>
          {cancelLabel}
        </button>
        <button
          className={`cc-btn ${danger ? 'cc-btn--danger' : 'cc-btn--primary'}`}
          onClick={handleConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
