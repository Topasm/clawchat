import type { ChatMessage } from '../../stores/useChatStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import {
  CopyIcon,
  EditIcon,
  SparkleIcon,
  SpinArrowsIcon,
  TrashIcon,
  UserIcon,
} from '../shared/Icons';
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
  search: 'Searched',
  daily_briefing: 'Daily briefing',
  delegate_task: 'Running task',
  suggest_time: 'Scheduling',
  check_conflicts: 'Checking conflicts',
  analyze_schedule: 'Analyzing schedule',
};

interface MessageBubbleProps {
  message: ChatMessage;
  projectIcon?: string;
  onDelete?: () => void;
  onRegenerate?: () => void;
  onEdit?: (messageId: string) => void;
}

export default function MessageBubble({ message, projectIcon, onDelete, onRegenerate, onEdit }: MessageBubbleProps) {
  const showTimestamps = useSettingsStore((s) => s.showTimestamps);
  const showAvatars = useSettingsStore((s) => s.showAvatars);
  const isUser = message.user._id === 'user';
  const role = isUser ? 'user' : 'assistant';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.text);
    } catch {
      // Clipboard API not available in this context
    }
  };

  const intent = message.metadata?.intent as string | undefined;
  const intentLabel = intent && intent !== 'general_chat' ? INTENT_LABELS[intent] : null;

  return (
    <div className={`cc-bubble-row cc-bubble-row--${role}`}>
      {!isUser && showAvatars && (
        <div className="cc-avatar cc-avatar--assistant">
          {projectIcon ? <span style={{ fontSize: 16, lineHeight: 1 }}>{projectIcon}</span> : <SparkleIcon size={16} />}
        </div>
      )}
      <div className={`cc-bubble cc-bubble--${role}`}>
        {!isUser && intentLabel && (
          <div className="cc-bubble__intent">{intentLabel}</div>
        )}
        <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{message.text}</span>
        {message.metadata && <ActionCard metadata={message.metadata} />}
        {showTimestamps && (
          <div className="cc-bubble__time">
            {new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </div>
        )}
        <div className="cc-bubble__actions">
          <button type="button" className="cc-bubble__action-btn" onClick={handleCopy} title="Copy" aria-label="Copy message">
            <CopyIcon size={12} />
          </button>
          {isUser && onEdit && (
            <button type="button" className="cc-bubble__action-btn" onClick={() => onEdit(message._id)} title="Edit" aria-label="Edit message">
              <EditIcon size={12} />
            </button>
          )}
          {!isUser && onRegenerate && (
            <button type="button" className="cc-bubble__action-btn" onClick={onRegenerate} title="Regenerate" aria-label="Regenerate response">
              <SpinArrowsIcon size={12} />
            </button>
          )}
          {onDelete && (
            <button type="button" className="cc-bubble__action-btn" onClick={onDelete} title="Delete" aria-label="Delete message">
              <TrashIcon size={12} />
            </button>
          )}
        </div>
      </div>
      {isUser && showAvatars && (
        <div className="cc-avatar cc-avatar--user">
          <UserIcon size={16} />
        </div>
      )}
    </div>
  );
}
