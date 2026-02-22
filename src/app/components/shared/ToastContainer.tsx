import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useToastStore } from '../../stores/useToastStore';
import Toast from './Toast';

export default function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);

  return createPortal(
    <div className="cc-toast-container">
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout
            initial={{ opacity: 0, x: 40, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.95 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
          >
            <Toast toast={toast} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  );
}
