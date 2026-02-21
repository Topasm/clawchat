import { useState, useRef, useEffect, type FormEvent } from 'react';
import { parseNaturalInput } from '../../utils/naturalLanguageParser';
import { useModuleStore } from '../../stores/useModuleStore';
import { useToastStore } from '../../stores/useToastStore';
import Badge from './Badge';

interface QuickCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function QuickCaptureModal({ isOpen, onClose }: QuickCaptureModalProps) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setText('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
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

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!parsed || !parsed.title) return;

    const now = new Date().toISOString();
    const id = `local-${Date.now()}`;

    if (parsed.type === 'event') {
      const start = parsed.startTime || parsed.dueDate || new Date();
      useModuleStore.getState().addEvent({
        id,
        title: parsed.title,
        start_time: start.toISOString(),
        created_at: now,
        updated_at: now,
      });
      useToastStore.getState().addToast('success', 'Event created');
    } else if (parsed.type === 'note') {
      useModuleStore.getState().addMemo({
        id,
        content: parsed.title,
        tags: [],
        created_at: now,
        updated_at: now,
      });
      useToastStore.getState().addToast('success', 'Memo saved');
    } else {
      useModuleStore.getState().addTodo({
        id,
        title: parsed.title,
        status: 'pending',
        priority: parsed.priority ?? undefined,
        due_date: parsed.dueDate?.toISOString(),
        tags: [],
        created_at: now,
        updated_at: now,
      });
      useToastStore.getState().addToast('success', 'Task created');
    }

    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="cc-modal-overlay" onClick={onClose}>
      <div className="cc-modal cc-quick-capture" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            className="cc-quick-capture__input"
            placeholder='Try "Buy groceries tomorrow" or "Meeting at 3pm"...'
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoComplete="off"
          />
          {parsed && text.trim() && (
            <div className="cc-quick-capture__preview">
              <span className="cc-quick-capture__type">
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
      </div>
    </div>
  );
}
