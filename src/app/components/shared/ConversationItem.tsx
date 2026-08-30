import type { ConversationResponse } from '../../types/api';
import { formatRelativeTime, truncate } from '../../utils/formatters';
import { ChatBubbleIcon, TrashIcon } from './Icons';
import { translateUi } from '../../i18n';
interface ConversationItemProps {
  conversation: ConversationResponse;
  onClick: () => void;
  onDelete?: () => void;
}
export default function ConversationItem({
  conversation,
  onClick,
  onDelete,
}: ConversationItemProps) {
  return (
    <div className="cc-convo-item" onClick={onClick}>
      <div className="cc-convo-item__avatar">
        <ChatBubbleIcon size={24} />
      </div>
      <div className="cc-convo-item__body">
        <div className="cc-convo-item__title">
          {conversation.title || translateUi('New Conversation')}
        </div>
        {conversation.last_message && (
          <div className="cc-convo-item__preview">{truncate(conversation.last_message, 60)}</div>
        )}
      </div>
      <div className="cc-convo-item__time">{formatRelativeTime(conversation.updated_at)}</div>
      {onDelete && (
        <button
          type="button"
          className="cc-btn cc-btn--ghost cc-convo-item__delete"
          style={{ color: 'var(--cc-error)', marginLeft: 4, padding: '4px 8px', fontSize: 12 }}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title={translateUi('Delete conversation')}
          aria-label={translateUi('Delete conversation')}
        >
          <TrashIcon size={14} />
        </button>
      )}
    </div>
  );
}
