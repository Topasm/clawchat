import { useState, useRef, useCallback, useEffect, type KeyboardEvent } from 'react';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useAuthStore } from '../../stores/useAuthStore';
import useVoiceInput from '../../hooks/useVoiceInput';
import { CheckIcon, CloseIcon, MicrophoneIcon, SendIcon, StopIcon } from '../shared/Icons';

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
  const healthOK = useAuthStore((s) => s.healthOK);
  const isEditing = !!editingMessageId;
  const { isListening, transcript, isSupported: voiceSupported, startListening, stopListening } = useVoiceInput();

  // Append voice transcript to text when available
  useEffect(() => {
    if (transcript) {
      setText((prev) => (prev ? prev + ' ' + transcript : transcript));
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 96) + 'px';
      }
    }
  }, [transcript]);

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
          aria-label="Stop response"
        >
          <StopIcon size={14} />
        </button>
      ) : (
        <>
          {isEditing && (
            <button
              type="button"
              className="cc-chat-input__cancel-btn"
              onClick={handleCancel}
              title="Cancel edit"
              aria-label="Cancel edit"
            >
              <CloseIcon size={14} />
            </button>
          )}
          {voiceSupported && (
            <button
              type="button"
              className={`cc-chat-input__btn cc-chat-input__btn--mic${isListening ? ' cc-chat-input__btn--active' : ''}`}
              onClick={isListening ? stopListening : startListening}
              title={isListening ? 'Stop listening' : 'Voice input'}
              aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
            >
              <MicrophoneIcon size={16} />
            </button>
          )}
          <button
            type="button"
            className="cc-chat-input__btn cc-chat-input__btn--send"
            onClick={handleSend}
            disabled={!text.trim()}
            title={!healthOK ? 'Server status uncertain — try sending anyway' : isEditing ? 'Save edit' : 'Send'}
            aria-label={isEditing ? 'Save edited message' : 'Send message'}
          >
            {isEditing ? (
              <CheckIcon size={16} />
            ) : (
              <SendIcon size={16} />
            )}
          </button>
        </>
      )}
    </div>
  );
}
