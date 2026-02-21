import type { EventResponse } from '../../types/api';
import { formatTime } from '../../utils/formatters';

interface EventCardProps {
  event: EventResponse;
  onClick?: () => void;
}

export default function EventCard({ event, onClick }: EventCardProps) {
  return (
    <div className="cc-card cc-card--event" onClick={onClick}>
      <div
        className="cc-card__accent-bar"
        style={{ background: 'var(--cc-primary)' }}
      />
      <div className="cc-card__body">
        <div className="cc-card__title">{event.title}</div>
        <div className="cc-card__time">
          {formatTime(event.start_time)}
          {event.end_time && ` - ${formatTime(event.end_time)}`}
        </div>
        {event.location && (
          <div className="cc-card__location">{event.location}</div>
        )}
      </div>
    </div>
  );
}
