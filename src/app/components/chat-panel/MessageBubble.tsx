import type { ChatMessage } from '../../stores/useChatStore';
import { useSettingsStore } from '../../stores/useSettingsStore';

interface MessageBubbleProps {
  message: ChatMessage;
  onCopy?: () => void;
  onDelete?: () => void;
  onRegenerate?: () => void;
}

export default function MessageBubble({ message, onCopy, onDelete, onRegenerate }: MessageBubbleProps) {
  const showTimestamps = useSettingsStore((s) => s.showTimestamps);
  const isUser = message.user._id === 'user';
  const role = isUser ? 'user' : 'assistant';

  const handleCopy = () => {
    navigator.clipboard.writeText(message.text);
    onCopy?.();
  };

  return (
    <div className={`cc-bubble-row cc-bubble-row--${role}`}>
      <div className={`cc-bubble cc-bubble--${role}`}>
        {message.text}
        {showTimestamps && (
          <div className="cc-bubble__time">
            {new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </div>
        )}
        <div className="cc-bubble__actions">
          <button type="button" className="cc-bubble__action-btn" onClick={handleCopy} title="Copy">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="4" y="4" width="7" height="7" rx="1" />
              <path d="M8 4V2.5A1.5 1.5 0 006.5 1H2.5A1.5 1.5 0 001 2.5v4A1.5 1.5 0 002.5 8H4" />
            </svg>
          </button>
          {!isUser && onRegenerate && (
            <button type="button" className="cc-bubble__action-btn" onClick={onRegenerate} title="Regenerate">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M1 1v3.5h3.5M11 11V7.5H7.5" />
                <path d="M10 4.5A4.5 4.5 0 002 3L1 4.5M2 7.5A4.5 4.5 0 0010 9l1-1.5" />
              </svg>
            </button>
          )}
          {onDelete && (
            <button type="button" className="cc-bubble__action-btn" onClick={onDelete} title="Delete">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M1.5 3h9M4.5 3V2a1 1 0 011-1h1a1 1 0 011 1v1M9.5 3v7a1 1 0 01-1 1h-5a1 1 0 01-1-1V3" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
