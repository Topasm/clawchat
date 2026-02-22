import { useState, useRef, useCallback, useEffect, type KeyboardEvent } from 'react';
import { useSettingsStore } from '../../stores/useSettingsStore';

interface ChatInputProps {
  onSend: (text: string) => void;
  isStreaming: boolean;
  onStop: () => void;
  placeholder?: string;
  editingMessageId?: string | null;
  editingText?: string;
  onCancelEdit?: () => void;
}

export default function ChatInput({
  onSend,
  isStreaming,
  onStop,
  placeholder = 'Type a message...',
  editingMessageId,
  editingText,
  onCancelEdit,
}: ChatInputProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendOnEnter = useSettingsStore((s) => s.sendOnEnter);
  const isEditing = !!editingMessageId;

  // Pre-fill textarea when entering edit mode
  useEffect(() => {
    if (editingMessageId && editingText != null) {
      setText(editingText);
      // Focus and resize the textarea
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 96) + 'px';
      }
    }
  }, [editingMessageId, editingText]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, onSend]);

  const handleCancel = useCallback(() => {
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    onCancelEdit?.();
  }, [onCancelEdit]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isEditing && e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
      return;
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
      return;
    }
    if (sendOnEnter && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = () => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 96) + 'px';
    }
  };

  return (
    <div className={`cc-chat-input${isEditing ? ' cc-chat-input--editing' : ''}`}>
      <textarea
        ref={textareaRef}
        className="cc-chat-input__textarea"
        value={text}
        onChange={(e) => { setText(e.target.value); handleInput(); }}
        onKeyDown={handleKeyDown}
        placeholder={isEditing ? 'Edit message...' : placeholder}
        rows={1}
      />
      {isStreaming ? (
        <button
          type="button"
          className="cc-chat-input__btn cc-chat-input__btn--stop"
          onClick={onStop}
          title="Stop"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <rect x="2" y="2" width="10" height="10" rx="1" />
          </svg>
        </button>
      ) : (
        <>
          {isEditing && (
            <button
              type="button"
              className="cc-chat-input__cancel-btn"
              onClick={handleCancel}
              title="Cancel edit"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 3l8 8M11 3l-8 8" strokeLinecap="round" />
              </svg>
            </button>
          )}
          <button
            type="button"
            className="cc-chat-input__btn cc-chat-input__btn--send"
            onClick={handleSend}
            disabled={!text.trim()}
            title={isEditing ? 'Save edit' : 'Send'}
          >
            {isEditing ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 8l4 4L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M14 2L7 9M14 2L9.5 14L7 9M14 2L2 6.5L7 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </>
      )}
    </div>
  );
}
