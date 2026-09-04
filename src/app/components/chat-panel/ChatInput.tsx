import { useState, useRef, useCallback, useEffect, type KeyboardEvent } from 'react';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useAuthStore } from '../../stores/useAuthStore';
import useVoiceInput from '../../hooks/useVoiceInput';
import { CheckIcon, CloseIcon, MicrophoneIcon, SendIcon, StopIcon } from '../shared/Icons';
import { translateUi } from '../../i18n';
import { useChatStore } from '../../stores/useChatStore';
interface ChatInputProps {
  onSend: (text: string) => void | Promise<void>;
  isStreaming: boolean;
  onStop: () => void;
  draftKey?: string;
  placeholder?: string;
  editingMessageId?: string | null;
  editingText?: string;
  onCancelEdit?: () => void;
  modeLabel?: string;
  onClearMode?: () => void;
}
export default function ChatInput({
  onSend,
  isStreaming,
  onStop,
  draftKey,
  placeholder = 'Type a message...',
  editingMessageId,
  editingText,
  onCancelEdit,
  modeLabel,
  onClearMode,
}: ChatInputProps) {
  const storedDraft = useChatStore((state) => (draftKey ? (state.drafts[draftKey] ?? '') : ''));
  const setDraft = useChatStore((state) => state.setDraft);
  const [text, setText] = useState(() => storedDraft);
  const [isSending, setIsSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendOnEnter = useSettingsStore((s) => s.sendOnEnter);
  const healthOK = useAuthStore((s) => s.healthOK);
  const isEditing = !!editingMessageId;
  const {
    isListening,
    transcript,
    isSupported: voiceSupported,
    startListening,
    stopListening,
  } = useVoiceInput();
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
  useEffect(() => {
    if (!isEditing) setText(storedDraft);
  }, [draftKey, isEditing, storedDraft]);
  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;
    setIsSending(true);
    try {
      await onSend(trimmed);
      setText('');
      if (draftKey) setDraft(draftKey, '');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    } catch {
      // The caller reports the error. Keep the draft so the user can retry.
    } finally {
      setIsSending(false);
    }
  }, [draftKey, isSending, onSend, setDraft, text]);
  const handleCancel = useCallback(() => {
    setText('');
    if (draftKey) setDraft(draftKey, '');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    onCancelEdit?.();
  }, [draftKey, onCancelEdit, setDraft]);
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isEditing && e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
      return;
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void handleSend();
      return;
    }
    if (sendOnEnter && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
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
      {modeLabel && !isEditing && (
        <div className="cc-chat-input__mode" role="status">
          <span>{modeLabel}</span>
          {onClearMode && (
            <button
              type="button"
              onClick={onClearMode}
              aria-label={translateUi('Exit agent answer mode')}
              title={translateUi('Send as a normal chat message')}
            >
              <CloseIcon size={12} />
            </button>
          )}
        </div>
      )}
      <textarea
        ref={textareaRef}
        className="cc-chat-input__textarea"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (draftKey && !isEditing) setDraft(draftKey, e.target.value);
          handleInput();
        }}
        onKeyDown={handleKeyDown}
        placeholder={
          isEditing
            ? translateUi('Edit message...')
            : modeLabel
              ? translateUi('Answer the agent...')
              : placeholder
        }
        rows={1}
      />
      {isStreaming ? (
        <button
          type="button"
          className="cc-chat-input__btn cc-chat-input__btn--stop"
          onClick={onStop}
          title={translateUi('Stop')}
          aria-label={translateUi('Stop response')}
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
              title={translateUi('Cancel edit')}
              aria-label={translateUi('Cancel edit')}
            >
              <CloseIcon size={14} />
            </button>
          )}
          {voiceSupported && (
            <button
              type="button"
              className={`cc-chat-input__btn cc-chat-input__btn--mic${isListening ? ' cc-chat-input__btn--active' : ''}`}
              onClick={isListening ? stopListening : startListening}
              title={isListening ? translateUi('Stop listening') : translateUi('Voice input')}
              aria-label={
                isListening ? translateUi('Stop voice input') : translateUi('Start voice input')
              }
            >
              <MicrophoneIcon size={16} />
            </button>
          )}
          <button
            type="button"
            className="cc-chat-input__btn cc-chat-input__btn--send"
            onClick={() => void handleSend()}
            disabled={!text.trim() || isSending}
            title={
              !healthOK
                ? translateUi('Server status uncertain \u2014 try sending anyway')
                : isEditing
                  ? translateUi('Save edit')
                  : translateUi('Send')
            }
            aria-label={
              isEditing ? translateUi('Save edited message') : translateUi('Send message')
            }
          >
            {isEditing ? <CheckIcon size={16} /> : <SendIcon size={16} />}
          </button>
        </>
      )}
    </div>
  );
}
