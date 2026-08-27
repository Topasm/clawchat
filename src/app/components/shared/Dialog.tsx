import * as RadixDialog from '@radix-ui/react-dialog';
import { CloseIcon } from './Icons';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export default function Dialog({ open, onOpenChange, title, children, className }: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="cc-dialog__overlay" />
        <RadixDialog.Content className={`cc-dialog__content ${className ?? ''}`}>
          {title && (
            <div className="cc-dialog__header">
              <RadixDialog.Title className="cc-dialog__title">{title}</RadixDialog.Title>
              <RadixDialog.Close className="cc-dialog__close" aria-label="Close">
                <CloseIcon size={14} />
              </RadixDialog.Close>
            </div>
          )}
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export { RadixDialog };
