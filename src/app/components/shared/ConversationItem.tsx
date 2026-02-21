import type { ConversationResponse } from '../../types/api';
import { formatRelativeTime, truncate } from '../../utils/formatters';

interface ConversationItemProps {
  conversation: ConversationResponse;
  onClick: () => void;
  onDelete?: () => void;
}

export default function ConversationItem({ conversation, onClick, onDelete }: ConversationItemProps) {
  return (
    <div className="cc-convo-item" onClick={onClick}>
      <div className="cc-convo-item__avatar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="cc-convo-item__body">
        <div className="cc-convo-item__title">
          {conversation.title || 'New Conversation'}
        </div>
        {conversation.last_message && (
          <div className="cc-convo-item__preview">
            {truncate(conversation.last_message, 60)}
          </div>
        )}
      </div>
      <div className="cc-convo-item__time">
        {formatRelativeTime(conversation.updated_at)}
      </div>
      {onDelete && (
        <button
          type="button"
          className="cc-btn cc-btn--ghost cc-convo-item__delete"
          style={{ color: 'var(--cc-error)', marginLeft: 4, padding: '4px 8px', fontSize: 12 }}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete conversation"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 4h12M5.3 4V2.7a1 1 0 011-1h3.4a1 1 0 011 1V4M6.8 7.3v4M9.2 7.3v4M12.7 4v9.3a1 1 0 01-1 1H4.3a1 1 0 01-1-1V4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
