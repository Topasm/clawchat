import { useMemo } from 'react';
import type { EventResponse, TodoResponse } from '../../types/api';
import {
  dayNames,
  WEEK_START_HOUR,
  startOfWeek,
  getWeekDates,
  toDateKey,
  isSameDay,
} from '../../utils/calendarUtils';
import type { CalendarTaskSegment } from '../../utils/calendarUtils';
import TaskBar from './TaskBar';
import { translateUi } from '../../i18n';

interface WeekViewProps {
  currentDate: Date;
  today: Date;
  eventsByDate: Map<string, EventResponse[]>;
  tasksByDate: Map<string, CalendarTaskSegment[]>;
  onTimeSlotClick: (date: Date, hour: number) => void;
  onEventClick: (ev: EventResponse, e: React.MouseEvent) => void;
  onTaskClick: (todo: TodoResponse, e: React.MouseEvent) => void;
}

/** "10:30": a week column has room for the time, not for AM and PM. */
export function eventClock(startTime: string): string {
  const start = new Date(startTime);
  return `${start.getHours()}:${String(start.getMinutes()).padStart(2, '0')}`;
}

/**
 * The week as seven columns side by side, as the design draws it: each day
 * lists its calendar events (a red rule, with the time) and then the tasks
 * due that day (grey). Today's column is tinted. A click on the empty part
 * of a day adds something to it.
 */
export default function WeekView({
  currentDate,
  today,
  eventsByDate,
  tasksByDate,
  onTimeSlotClick,
  onEventClick,
  onTaskClick,
}: WeekViewProps) {
  const ws = useMemo(() => startOfWeek(currentDate), [currentDate]);
  const weekDates = useMemo(() => getWeekDates(ws), [ws]);

  return (
    <div className="cc-calendar__week cc-calendar__week--columns">
      <div className="cc-calendar__week-days">
        {weekDates.map((date) => {
          const key = toDateKey(date);
          const isToday = isSameDay(date, today);
          // All-day first, then by time.
          const dayEvents = [...(eventsByDate.get(key) ?? [])].sort(
            (a, b) =>
              Number(b.is_all_day) - Number(a.is_all_day) ||
              a.start_time.localeCompare(b.start_time),
          );
          const dayTasks = tasksByDate.get(key) ?? [];
          return (
            <section
              key={key}
              className={`cc-calendar__week-day${isToday ? ' cc-calendar__week-day--today' : ''}`}
              aria-label={date.toDateString()}
            >
              <header className="cc-calendar__week-day-head">
                <span className="cc-calendar__week-day-name">{dayNames()[date.getDay()]}</span>
                <span className="cc-calendar__week-day-number">{date.getDate()}</span>
              </header>
              <div className="cc-calendar__week-day-items">
                {dayEvents.map((ev) => (
                  <button
                    key={ev.id}
                    type="button"
                    className="cc-calendar__week-event"
                    onClick={(e) => onEventClick(ev, e)}
                    title={ev.title}
                  >
                    <span className="cc-calendar__week-event-title">{ev.title}</span>
                    {!ev.is_all_day && (
                      <span className="cc-calendar__week-event-time">
                        {eventClock(ev.start_time)}
                      </span>
                    )}
                  </button>
                ))}
                {dayTasks.map((segment) => (
                  <TaskBar
                    key={segment.todo.id}
                    segment={segment}
                    onClick={(e) => onTaskClick(segment.todo, e)}
                  />
                ))}
                <button
                  type="button"
                  className="cc-calendar__week-day-fill"
                  aria-label={translateUi('Add to {{day}}', { day: date.toLocaleDateString() })}
                  onClick={() => onTimeSlotClick(date, WEEK_START_HOUR)}
                />
              </div>
            </section>
          );
        })}
      </div>
      <p className="cc-calendar__week-legend">
        {translateUi('Red rule = calendar event · grey = task with a deadline')}
      </p>
    </div>
  );
}
