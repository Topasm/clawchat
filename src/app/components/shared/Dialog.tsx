import * as RadixDialog from '@radix-ui/react-dialog';
import { CloseIcon } from './Icons';
import { translateUi } from '../../i18n';
import useThemedPortalContainer from '../../hooks/useThemedPortalContainer';
interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
}
export default function Dialog({ open, onOpenChange, title, children, className }: DialogProps) {
  const container = useThemedPortalContainer();
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal container={container}>
        <RadixDialog.Overlay className="cc-dialog__overlay" />
        <RadixDialog.Content className={`cc-dialog__content ${className ?? ''}`}>
          {title && (
            <div className="cc-dialog__header">
              <RadixDialog.Title className="cc-dialog__title">{title}</RadixDialog.Title>
              <RadixDialog.Close className="cc-dialog__close" aria-label={translateUi('Close')}>
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
