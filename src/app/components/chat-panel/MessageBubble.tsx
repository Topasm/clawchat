import type { ChatMessage } from '../../stores/useChatStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import ActionCard from './ActionCard';

const INTENT_LABELS: Record<string, string> = {
  create_todo: 'Created task',
  query_todos: 'Searched tasks',
  update_todo: 'Updated task',
  delete_todo: 'Deleted task',
  complete_todo: 'Completed task',
  create_event: 'Created event',
  query_events: 'Searched events',
  update_event: 'Updated event',
  delete_event: 'Deleted event',
  create_memo: 'Created memo',
  query_memos: 'Searched memos',
  update_memo: 'Updated memo',
  delete_memo: 'Deleted memo',
  search: 'Searched',
  daily_briefing: 'Daily briefing',
  delegate_task: 'Running task',
  suggest_time: 'Scheduling',
  check_conflicts: 'Checking conflicts',
  analyze_schedule: 'Analyzing schedule',
};

interface MessageBubbleProps {
  message: ChatMessage;
  onDelete?: () => void;
  onRegenerate?: () => void;
  onEdit?: (messageId: string) => void;
}

export default function MessageBubble({ message, onDelete, onRegenerate, onEdit }: MessageBubbleProps) {
  const showTimestamps = useSettingsStore((s) => s.showTimestamps);
  const isUser = message.user._id === 'user';
  const role = isUser ? 'user' : 'assistant';

  const handleCopy = () => {
    navigator.clipboard.writeText(message.text);
  };

  const intent = message.metadata?.intent as string | undefined;
  const intentLabel = intent && intent !== 'general_chat' ? INTENT_LABELS[intent] : null;

  return (
    <div className={`cc-bubble-row cc-bubble-row--${role}`}>
      <div className={`cc-bubble cc-bubble--${role}`}>
        {!isUser && intentLabel && (
          <div className="cc-bubble__intent">{intentLabel}</div>
        )}
        {message.text}
        {message.metadata && <ActionCard metadata={message.metadata} />}
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
          {isUser && onEdit && (
            <button type="button" className="cc-bubble__action-btn" onClick={() => onEdit(message._id)} title="Edit">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M8.5 1.5l2 2M1 11l.5-2L9 1.5l2 2L3.5 11H1z" />
              </svg>
            </button>
          )}
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
