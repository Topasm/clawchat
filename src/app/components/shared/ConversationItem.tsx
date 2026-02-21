import type { ConversationResponse } from '../../types/api';
import { formatRelativeTime, truncate } from '../../utils/formatters';

interface ConversationItemProps {
  conversation: ConversationResponse;
  onClick: () => void;
}

export default function ConversationItem({ conversation, onClick }: ConversationItemProps) {
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
    </div>
  );
}
