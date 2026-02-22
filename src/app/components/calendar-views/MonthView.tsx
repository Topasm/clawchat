import { useMemo } from 'react';
import type { EventResponse } from '../../types/api';
import {
  DAY_NAMES,
  MAX_VISIBLE_PILLS,
  getMonthGrid,
  toDateKey,
  isSameDay,
} from '../../utils/calendarUtils';
import EventPill from './EventPill';

interface MonthViewProps {
  year: number;
  month: number;
  today: Date;
  eventsByDate: Map<string, EventResponse[]>;
  onDayClick: (date: Date) => void;
  onEventClick: (ev: EventResponse, e: React.MouseEvent) => void;
}

export default function MonthView({
  year,
  month,
  today,
  eventsByDate,
  onDayClick,
  onEventClick,
}: MonthViewProps) {
  const grid = useMemo(() => getMonthGrid(year, month), [year, month]);

  return (
    <div className="cc-calendar__month">
      {/* Day-of-week headers */}
      <div className="cc-calendar__dow-row">
        {DAY_NAMES.map((name) => (
          <div key={name} className="cc-calendar__dow">{name}</div>
        ))}
      </div>

      {/* Day cells */}
      <div className="cc-calendar__grid">
        {grid.map((date, idx) => {
          const key = toDateKey(date);
          const dayEvents = eventsByDate.get(key) ?? [];
          const isCurrentMonth = date.getMonth() === month;
          const isToday = isSameDay(date, today);
          const overflow = dayEvents.length - MAX_VISIBLE_PILLS;

          let cellClass = 'cc-calendar__cell';
          if (!isCurrentMonth) cellClass += ' cc-calendar__cell--other-month';
          if (isToday) cellClass += ' cc-calendar__cell--today';

          return (
            <div
              key={idx}
              className={cellClass}
              onClick={() => onDayClick(date)}
            >
              <span className={`cc-calendar__day-number${isToday ? ' cc-calendar__day-number--today' : ''}`}>
                {date.getDate()}
              </span>
              <div className="cc-calendar__cell-events">
                {dayEvents.slice(0, MAX_VISIBLE_PILLS).map((ev) => (
                  <EventPill key={ev.id} event={ev} onClick={(e) => onEventClick(ev, e)} />
                ))}
                {overflow > 0 && (
                  <span className="cc-calendar__more">+{overflow} more</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
