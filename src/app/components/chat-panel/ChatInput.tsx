import { useState, useRef, useCallback, type KeyboardEvent } from 'react';
import { useSettingsStore } from '../../stores/useSettingsStore';

interface ChatInputProps {
  onSend: (text: string) => void;
  isStreaming: boolean;
  onStop: () => void;
  placeholder?: string;
}

export default function ChatInput({ onSend, isStreaming, onStop, placeholder = 'Type a message...' }: ChatInputProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendOnEnter = useSettingsStore((s) => s.sendOnEnter);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, onSend]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
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
    <div className="cc-chat-input">
      <textarea
        ref={textareaRef}
        className="cc-chat-input__textarea"
        value={text}
        onChange={(e) => { setText(e.target.value); handleInput(); }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
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
        <button
          type="button"
          className="cc-chat-input__btn cc-chat-input__btn--send"
          onClick={handleSend}
          disabled={!text.trim()}
          title="Send"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M14 2L7 9M14 2L9.5 14L7 9M14 2L2 6.5L7 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
