import type { EventResponse } from '../../types/api';
import { WEEK_START_HOUR } from '../../utils/calendarUtils';
import RepeatIcon from './RepeatIcon';

function fmtTime(h: number, m: number): string {
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export default function EventBlock({
  event,
  onClick,
}: {
  event: EventResponse;
  onClick: (e: React.MouseEvent) => void;
}) {
  const start = new Date(event.start_time);
  const end = event.end_time ? new Date(event.end_time) : new Date(start.getTime() + 30 * 60_000);
  const startMinutes = start.getHours() * 60 + start.getMinutes();
  const endMinutes = end.getHours() * 60 + end.getMinutes();
  const topOffset = startMinutes - WEEK_START_HOUR * 60;
  const height = Math.max(endMinutes - startMinutes, 15); // min 15min height

  return (
    <button
      type="button"
      className="cc-calendar__event-block"
      style={{
        top: `${topOffset}px`,
        height: `${height}px`,
      }}
      onClick={onClick}
      title={event.title}
    >
      <span className="cc-calendar__event-block-title">
        {event.title}
        {event.recurrence_rule && <> <RepeatIcon /></>}
      </span>
      <span className="cc-calendar__event-block-time">
        {fmtTime(start.getHours(), start.getMinutes())} - {fmtTime(end.getHours(), end.getMinutes())}
      </span>
    </button>
  );
}
