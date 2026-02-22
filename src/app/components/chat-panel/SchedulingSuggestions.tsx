import { useChatStore } from '../../stores/useChatStore';

interface Suggestion {
  start: string;
  end: string;
  reason: string;
}

interface SchedulingSuggestionsProps {
  suggestions: Suggestion[];
  title?: string;
}

export default function SchedulingSuggestions({ suggestions, title }: SchedulingSuggestionsProps) {
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const sendMessageStreaming = useChatStore((s) => s.sendMessageStreaming);

  const handleSchedule = (suggestion: Suggestion) => {
    if (!currentConversationId) return;
    const startDate = new Date(suggestion.start);
    const timeStr = startDate.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    sendMessageStreaming(
      currentConversationId,
      `Schedule "${title ?? 'the event'}" at ${timeStr}`,
    );
  };

  if (!suggestions?.length) return null;

  return (
    <div className="cc-action-card cc-action-card--suggestions">
      <div className="cc-action-card__content">
        <span className="cc-action-card__label">Suggested Times</span>
        {suggestions.map((s, i) => {
          const startDate = new Date(s.start);
          return (
            <div key={i} className="cc-action-card__suggestion">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span className="cc-action-card__detail">
                  {startDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}{' '}
                  at {startDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </span>
                <button
                  type="button"
                  className="cc-btn cc-btn--primary cc-action-card__schedule-btn"
                  onClick={() => handleSchedule(s)}
                >
                  Schedule this
                </button>
              </div>
              {s.reason && (
                <span className="cc-action-card__suggestion-reason">{s.reason}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
