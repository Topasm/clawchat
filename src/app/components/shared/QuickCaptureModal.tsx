import { useState, useRef, useEffect, useMemo, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { parseNaturalInput } from '../../utils/naturalLanguageParser';
import { useToastStore } from '../../stores/useToastStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useTodosQuery, useCreateTodo, queryKeys } from '../../hooks/queries';
import { hapticSuccess } from '../../utils/haptics';
import Badge from './Badge';
import type { EventResponse, TodoResponse } from '../../types/api';

interface QuickCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  placeholder?: string;
  defaultParentId?: string;
  parentTitle?: string;
}

type ReceiptMessage = 'Saved to Inbox' | 'Added as subtask' | 'Saved locally';

export default function QuickCaptureModal({ isOpen, onClose, placeholder, defaultParentId, parentTitle }: QuickCaptureModalProps) {
  const [text, setText] = useState('');
  const [receipt, setReceipt] = useState<ReceiptMessage | null>(null);
  const [keepOpen, setKeepOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const receiptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: todos = [] } = useTodosQuery();
  const createTodoMutation = useCreateTodo();

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
    navigate('/inbox');
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!parsed || !parsed.title) return;

    const now = new Date().toISOString();
    const id = `local-${Date.now()}`;

    if (parsed.type === 'event') {
      const start = parsed.startTime || parsed.dueDate || new Date();
      // Add event optimistically to query cache
      const optimisticEvent: EventResponse = {
        id,
        title: parsed.title,
        start_time: start.toISOString(),
        created_at: now,
        updated_at: now,
      };
      queryClient.setQueryData<EventResponse[]>(queryKeys.events, (old) => [optimisticEvent, ...(old ?? [])]);
      showReceipt('Saved to Inbox');
    } else {
      if (isConnected) {
        // Use server createTodo mutation for inbox pipeline
        createTodoMutation.mutate({
          title: parsed.title,
          priority: parsed.priority ?? 'medium',
          due_date: parsed.dueDate?.toISOString(),
          tags: [],
          parent_id: defaultParentId,
          source: defaultParentId ? undefined : 'quick_capture',
          inbox_state: defaultParentId ? 'none' : 'classifying',
          recurrence_rule: parsed.recurrenceRule ?? undefined,
        });
        showReceipt(defaultParentId ? 'Added as subtask' : 'Saved to Inbox');
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
        queryClient.setQueryData<TodoResponse[]>(queryKeys.todos, (old) => [optimisticTodo, ...(old ?? [])]);
        showReceipt('Saved locally');
      }
    }

    hapticSuccess();
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
                  <svg className="cc-quick-capture__receipt-icon" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="10" cy="10" r="7" />
                    <path d="M7 10l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>{receipt}</span>
                </motion.div>
                <div className="cc-quick-capture__receipt-actions">
                  <button
                    type="button"
                    className="cc-quick-capture__receipt-link"
                    onClick={handleKeepCapturing}
                  >
                    Keep capturing
                  </button>
                  {!defaultParentId && (
                    <button
                      type="button"
                      className="cc-quick-capture__receipt-link"
                      onClick={handleReviewNow}
                    >
                      Review now
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                {defaultParentId && resolvedParentTitle && (
                  <div className="cc-quick-capture__parent-context">
                    Adding to: <strong>{resolvedParentTitle}</strong>
                  </div>
                )}
                <input
                  ref={inputRef}
                  type="text"
                  className="cc-quick-capture__input"
                  placeholder={placeholder || 'Try "Buy groceries tomorrow" or "Meeting at 3pm"...'}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  autoComplete="off"
                />
                {parsed && text.trim() && (
                  <div className="cc-quick-capture__preview">
                    <span className="cc-quick-capture__chip">
                      {parsed.type === 'event' ? (
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <rect x="1.5" y="2.5" width="9" height="8" rx="1" />
                          <path d="M1.5 5.5h9" />
                          <path d="M4 1v2M8 1v2" strokeLinecap="round" />
                        </svg>
                      ) : (
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <circle cx="6" cy="6" r="4.5" />
                          <path d="M4 6l1.5 1.5 3-3" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                      {parsed.type === 'event' ? 'Event' : parsed.type === 'note' ? 'Note' : 'Task'}
                    </span>
                    {parsed.priority && (
                      <Badge variant="priority" level={parsed.priority} />
                    )}
                    {parsed.dueDate && (
                      <Badge variant="due" dueDate={parsed.dueDate.toISOString()} />
                    )}
                    {parsed.startTime && (
                      <span className="cc-quick-capture__time">
                        {parsed.startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                    <span className="cc-quick-capture__flow-chip">
                      {defaultParentId ? (
                        <>
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M2 5h6M6 3l2 2-2 2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          Subtask
                        </>
                      ) : (
                        <>
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M2 5h6M6 3l2 2-2 2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          Inbox
                        </>
                      )}
                    </span>
                  </div>
                )}
                <div className="cc-quick-capture__actions">
                  <button type="button" className="cc-btn cc-btn--ghost" onClick={onClose}>
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="cc-btn cc-btn--primary"
                    disabled={!parsed?.title}
                  >
                    Create
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
