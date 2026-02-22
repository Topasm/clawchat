import type { EventResponse } from '../../types/api';
import { pillTime } from '../../utils/calendarUtils';
import RepeatIcon from './RepeatIcon';

export default function EventPill({
  event,
  onClick,
}: {
  event: EventResponse;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      className="cc-calendar__event-pill"
      onClick={onClick}
      title={event.title}
    >
      <span className="cc-calendar__event-pill-time">{pillTime(event)}</span>
      <span className="cc-calendar__event-pill-title">{event.title}</span>
      {event.recurrence_rule && <RepeatIcon />}
    </button>
  );
}
