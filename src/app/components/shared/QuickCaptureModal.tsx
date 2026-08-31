import { useState, useRef, useEffect, useMemo, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { parseNaturalInput } from '../../utils/naturalLanguageParser';
import { useAuthStore } from '../../stores/useAuthStore';
import { useTodosQuery, useCreateEvent, useCreateTodo, queryKeys } from '../../hooks/queries';
import { hapticSuccess } from '../../utils/haptics';
import Badge from './Badge';
import { ArrowRightIcon, CalendarIcon, CheckCircleIcon } from './Icons';
import type { EventResponse, TodoResponse } from '../../types/api';
import { translateUi } from '../../i18n';
interface QuickCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  placeholder?: string;
  defaultParentId?: string;
  parentTitle?: string;
}
type ReceiptMessage = 'Event created' | 'Saved to Inbox' | 'Added as subtask' | 'Saved locally';
export default function QuickCaptureModal({
  isOpen,
  onClose,
  placeholder,
  defaultParentId,
  parentTitle,
}: QuickCaptureModalProps) {
  const [text, setText] = useState('');
  const [receipt, setReceipt] = useState<ReceiptMessage | null>(null);
  const [keepOpen, setKeepOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const receiptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: todos = [] } = useTodosQuery();
  const createTodoMutation = useCreateTodo();
  const createEventMutation = useCreateEvent();
  useEffect(() => {
    if (isOpen) {
      setText('');
      setReceipt(null);
      setKeepOpen(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    return () => {
      if (receiptTimerRef.current) clearTimeout(receiptTimerRef.current);
    };
  }, [isOpen]);
  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);
  const parsed = text.trim() ? parseNaturalInput(text) : null;
  const isConnected = !!useAuthStore.getState().serverUrl;
  // Resolve parent title for display using query data
  const resolvedParentTitle = useMemo(() => {
    if (!defaultParentId) return null;
    if (parentTitle) return parentTitle;
    const parent = todos.find((t) => t.id === defaultParentId);
    return parent?.title ?? 'parent task';
  }, [defaultParentId, parentTitle, todos]);
  const showReceipt = (message: ReceiptMessage) => {
    setReceipt(message);
    if (receiptTimerRef.current) clearTimeout(receiptTimerRef.current);
    receiptTimerRef.current = setTimeout(() => {
      if (!keepOpen) {
        onClose();
      } else {
        setText('');
        setReceipt(null);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    }, 1500);
  };
  const finishCapture = (message: ReceiptMessage) => {
    showReceipt(message);
    hapticSuccess();
  };
  const handleKeepCapturing = () => {
    setKeepOpen(true);
    setText('');
    setReceipt(null);
    if (receiptTimerRef.current) clearTimeout(receiptTimerRef.current);
    setTimeout(() => inputRef.current?.focus(), 50);
  };
  const handleReviewNow = () => {
    if (receiptTimerRef.current) clearTimeout(receiptTimerRef.current);
    onClose();
    navigate(receipt === 'Event created' ? '/calendar' : '/inbox');
  };
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!parsed || !parsed.title) return;
    const now = new Date().toISOString();
    const id = `local-${Date.now()}`;
    if (parsed.type === 'event') {
      const start = parsed.startTime || parsed.dueDate || new Date();
      if (isConnected) {
        createEventMutation.mutate(
          {
            title: parsed.title,
            start_time: start.toISOString(),
            recurrence_rule: parsed.recurrenceRule ?? undefined,
          },
          { onSuccess: () => finishCapture('Event created') },
        );
      } else {
        const optimisticEvent: EventResponse = {
          id,
          title: parsed.title,
          start_time: start.toISOString(),
          created_at: now,
          updated_at: now,
        };
        queryClient.setQueryData<EventResponse[]>(queryKeys.events, (old) => [
          optimisticEvent,
          ...(old ?? []),
        ]);
        finishCapture('Saved locally');
      }
    } else {
      if (isConnected) {
        // Use server createTodo mutation for inbox pipeline
        createTodoMutation.mutate(
          {
            title: parsed.title,
            priority: parsed.priority ?? 'medium',
            due_date: parsed.dueDate?.toISOString(),
            tags: [],
            parent_id: defaultParentId,
            source: defaultParentId ? undefined : 'quick_capture',
            inbox_state: defaultParentId ? 'none' : 'classifying',
            recurrence_rule: parsed.recurrenceRule ?? undefined,
          },
          {
            onSuccess: () => finishCapture(defaultParentId ? 'Added as subtask' : 'Saved to Inbox'),
          },
        );
      } else {
        // Offline: local-only creation in query cache
        const optimisticTodo: TodoResponse = {
          id,
          title: parsed.title,
          status: 'pending',
          priority: parsed.priority ?? undefined,
          due_date: parsed.dueDate?.toISOString(),
          tags: [],
          parent_id: defaultParentId ?? null,
          sort_order: 0,
          created_at: now,
          updated_at: now,
        };
        queryClient.setQueryData<TodoResponse[]>(queryKeys.todos, (old) => [
          optimisticTodo,
          ...(old ?? []),
        ]);
        finishCapture('Saved locally');
      }
    }
  };
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="cc-modal-overlay"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <motion.div
            className="cc-modal cc-quick-capture"
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: -12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.97 }}
            transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
          >
            {receipt ? (
              <div className="cc-quick-capture__receipt">
                <motion.div
                  className="cc-quick-capture__receipt-message"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2 }}
                >
                  <CheckCircleIcon size={20} className="cc-quick-capture__receipt-icon" />
                  <span>{receipt}</span>
                </motion.div>
                <div className="cc-quick-capture__receipt-actions">
                  <button
                    type="button"
                    className="cc-quick-capture__receipt-link"
                    onClick={handleKeepCapturing}
                  >
                    {translateUi('\n                    Keep capturing\n                  ')}
                  </button>
                  {!defaultParentId && (
                    <button
                      type="button"
                      className="cc-quick-capture__receipt-link"
                      onClick={handleReviewNow}
                    >
                      {translateUi('\n                      Review now\n                    ')}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                {defaultParentId && resolvedParentTitle && (
                  <div className="cc-quick-capture__parent-context">
                    {translateUi('\n                    Adding to: ')}
                    <strong>{resolvedParentTitle}</strong>
                  </div>
                )}
                <input
                  ref={inputRef}
                  type="text"
                  className="cc-quick-capture__input"
                  placeholder={
                    placeholder ||
                    translateUi('Try "Buy groceries tomorrow" or "Meeting at 3pm"...')
                  }
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  autoComplete="off"
                />
                {parsed && text.trim() && (
                  <div className="cc-quick-capture__preview">
                    <span className="cc-quick-capture__chip">
                      {parsed.type === 'event' ? (
                        <CalendarIcon size={12} />
                      ) : (
                        <CheckCircleIcon size={12} />
                      )}
                      {parsed.type === 'event'
                        ? translateUi('Event')
                        : parsed.type === 'note'
                          ? translateUi('Note')
                          : translateUi('Task')}
                    </span>
                    {parsed.priority && <Badge variant="priority" level={parsed.priority} />}
                    {parsed.dueDate && (
                      <Badge variant="due" dueDate={parsed.dueDate.toISOString()} />
                    )}
                    {parsed.startTime && (
                      <span className="cc-quick-capture__time">
                        {parsed.startTime.toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    )}
                    <span className="cc-quick-capture__flow-chip">
                      {defaultParentId ? (
                        <>
                          <ArrowRightIcon size={10} />
                          {translateUi(
                            '\n                          Subtask\n                        ',
                          )}
                        </>
                      ) : (
                        <>
                          <ArrowRightIcon size={10} />
                          {translateUi(
                            '\n                          Inbox\n                        ',
                          )}
                        </>
                      )}
                    </span>
                  </div>
                )}
                <div className="cc-quick-capture__actions">
                  <button type="button" className="cc-btn cc-btn--ghost" onClick={onClose}>
                    {translateUi('\n                    Cancel\n                  ')}
                  </button>
                  <button
                    type="submit"
                    className="cc-btn cc-btn--primary"
                    disabled={!parsed?.title}
                  >
                    {translateUi('\n                    Create\n                  ')}
                  </button>
                </div>
              </form>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
