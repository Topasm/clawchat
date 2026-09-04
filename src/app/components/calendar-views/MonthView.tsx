import { useMemo } from 'react';
import type { EventResponse, TodoResponse } from '../../types/api';
import {
  DAY_NAMES,
  MAX_VISIBLE_PILLS,
  getMonthGrid,
  toDateKey,
  isSameDay,
} from '../../utils/calendarUtils';
import type { CalendarTaskSegment } from '../../utils/calendarUtils';
import EventPill from './EventPill';
import TaskBar from './TaskBar';
import { translateUi } from '../../i18n';
interface MonthViewProps {
  year: number;
  month: number;
  today: Date;
  eventsByDate: Map<string, EventResponse[]>;
  tasksByDate: Map<string, CalendarTaskSegment[]>;
  onDayClick: (date: Date) => void;
  onEventClick: (ev: EventResponse, e: React.MouseEvent) => void;
  onTaskClick: (todo: TodoResponse, e: React.MouseEvent) => void;
}
export default function MonthView({
  year,
  month,
  today,
  eventsByDate,
  tasksByDate,
  onDayClick,
  onEventClick,
  onTaskClick,
}: MonthViewProps) {
  const grid = useMemo(() => getMonthGrid(year, month), [year, month]);
  return (
    <div className="cc-calendar__month">
      {/* Day-of-week headers */}
      <div className="cc-calendar__dow-row">
        {DAY_NAMES.map((name) => (
          <div key={name} className="cc-calendar__dow">
            {name}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="cc-calendar__grid">
        {grid.map((date, idx) => {
          const key = toDateKey(date);
          const dayEvents = eventsByDate.get(key) ?? [];
          const dayTasks = tasksByDate.get(key) ?? [];
          const isCurrentMonth = date.getMonth() === month;
          const isToday = isSameDay(date, today);
          const visibleTasks = dayTasks.slice(0, MAX_VISIBLE_PILLS);
          const visibleEvents = dayEvents.slice(
            0,
            Math.max(MAX_VISIBLE_PILLS - visibleTasks.length, 0),
          );
          const overflow =
            dayTasks.length + dayEvents.length - visibleTasks.length - visibleEvents.length;
          // A bar running into this week needs its label repeated, otherwise
          // the only labelled day may sit weeks above.
          const opensWeekRow = idx % 7 === 0;
          let cellClass = 'cc-calendar__cell';
          if (!isCurrentMonth) cellClass += ' cc-calendar__cell--other-month';
          if (isToday) cellClass += ' cc-calendar__cell--today';
          return (
            <div key={idx} className={cellClass} onClick={() => onDayClick(date)}>
              <span
                className={`cc-calendar__day-number${isToday ? ' cc-calendar__day-number--today' : ''}`}
              >
                {date.getDate()}
              </span>
              <div className="cc-calendar__cell-events">
                {visibleTasks.map((segment) => (
                  <TaskBar
                    key={segment.todo.id}
                    segment={segment}
                    showTitle={
                      opensWeekRow || segment.position === 'start' || segment.position === 'single'
                    }
                    onClick={(e) => onTaskClick(segment.todo, e)}
                  />
                ))}
                {visibleEvents.map((ev) => (
                  <EventPill key={ev.id} event={ev} onClick={(e) => onEventClick(ev, e)} />
                ))}
                {overflow > 0 && (
                  <span className="cc-calendar__more">
                    +{overflow}
                    {translateUi(' more')}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
