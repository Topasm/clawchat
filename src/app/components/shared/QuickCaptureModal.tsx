import { useEffect } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { useCreateTodo, useTodosQuery } from '../../hooks/queries';
import useInboxCapture from '../../hooks/useInboxCapture';
import { useToastStore } from '../../stores/useToastStore';
import { hapticSuccess } from '../../utils/haptics';
import InboxCaptureBar from '../inbox/InboxCaptureBar';
import { translateUi } from '../../i18n';
interface QuickCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Adds the line as a step of this task instead of to the Inbox. */
  defaultParentId?: string;
}
/**
 * ⌘N on any screen: the Inbox's own input in a dialog. One line and Enter;
 * the Inbox files it, as if it had been typed there.
 */
export default function QuickCaptureModal({
  isOpen,
  onClose,
  defaultParentId,
}: QuickCaptureModalProps) {
  const { capture, busy: capturing } = useInboxCapture();
  const createTodo = useCreateTodo();
  const addToast = useToastStore((s) => s.addToast);
  const { data: todos = [] } = useTodosQuery();
  const parentTitle = defaultParentId
    ? todos.find((todo) => todo.id === defaultParentId)?.title
    : undefined;
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);
  const add = (title: string) => {
    const saved = defaultParentId
      ? createTodo.mutateAsync({ title, parent_id: defaultParentId, inbox_state: 'none' })
      : capture(title).then((todo) => {
          // A dated line is filed at once and the capture already said so.
          if (todo?.inbox_state !== 'none') addToast('success', translateUi('Saved to Inbox'));
        });
    return saved.then(() => {
      hapticSuccess();
      onClose();
    });
  };
  return (
    <AnimatePresence>
      {isOpen && (
        <m.div
          className="cc-modal-overlay"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <m.div
            className="cc-modal cc-quick-capture"
            role="dialog"
            aria-label={translateUi('Add to Inbox')}
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: -12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.97 }}
            transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
          >
            {parentTitle && (
              <div className="cc-quick-capture__parent-context">
                {translateUi('Adding to:')} <strong>{parentTitle}</strong>
              </div>
            )}
            <InboxCaptureBar
              autoFocus
              busy={capturing || createTodo.isPending}
              onCapture={add}
              label={defaultParentId ? translateUi('Add a step') : undefined}
            />
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}
