import { useMemo } from 'react';
import type { EventResponse, TodoResponse } from '../../types/api';
import {
  DAY_NAMES,
  WEEK_START_HOUR,
  WEEK_END_HOUR,
  startOfWeek,
  getWeekDates,
  toDateKey,
  isSameDay,
  formatTimeLabel,
} from '../../utils/calendarUtils';
import type { CalendarTaskSegment } from '../../utils/calendarUtils';
import EventBlock from './EventBlock';
import TaskBar from './TaskBar';

interface WeekViewProps {
  currentDate: Date;
  today: Date;
  eventsByDate: Map<string, EventResponse[]>;
  tasksByDate: Map<string, CalendarTaskSegment[]>;
  onTimeSlotClick: (date: Date, hour: number) => void;
  onEventClick: (ev: EventResponse, e: React.MouseEvent) => void;
  onTaskClick: (todo: TodoResponse, e: React.MouseEvent) => void;
}

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
  const hours = useMemo(() => {
    const arr: number[] = [];
    for (let h = WEEK_START_HOUR; h < WEEK_END_HOUR; h++) arr.push(h);
    return arr;
  }, []);

  return (
    <div className="cc-calendar__week">
      {/* Column headers */}
      <div className="cc-calendar__week-header">
        <div className="cc-calendar__time-gutter-header" />
        {weekDates.map((date, i) => {
          const isToday = isSameDay(date, today);
          return (
            <div
              key={i}
              className={`cc-calendar__week-col-header${isToday ? ' cc-calendar__week-col-header--today' : ''}`}
            >
              <span className="cc-calendar__week-day-name">{DAY_NAMES[date.getDay()]}</span>
              <span className={`cc-calendar__week-day-number${isToday ? ' cc-calendar__week-day-number--today' : ''}`}>
                {date.getDate()}
              </span>
            </div>
          );
        })}
      </div>

      {/* Task deadlines: no time of day, so they run above the hour grid */}
      <div className="cc-calendar__week-tasks">
        <div className="cc-calendar__time-gutter-header" />
        {weekDates.map((date, i) => {
          const dayTasks = tasksByDate.get(toDateKey(date)) ?? [];
          return (
            <div key={i} className="cc-calendar__week-tasks-col">
              {dayTasks.map((segment) => (
                <TaskBar
                  key={segment.todo.id}
                  segment={segment}
                  showTitle={
                    i === 0 || segment.position === 'start' || segment.position === 'single'
                  }
                  onClick={(e) => onTaskClick(segment.todo, e)}
                />
              ))}
            </div>
          );
        })}
      </div>

      {/* Body: time gutter + 7 columns */}
      <div className="cc-calendar__week-body">
        {/* Time gutter */}
        <div className="cc-calendar__time-gutter">
          {hours.map((h) => (
            <div key={h} className="cc-calendar__time-label" style={{ top: `${(h - WEEK_START_HOUR) * 60}px` }}>
              {formatTimeLabel(h)}
            </div>
          ))}
        </div>

        {/* Day columns */}
        {weekDates.map((date, colIdx) => {
          const key = toDateKey(date);
          const dayEvents = eventsByDate.get(key) ?? [];
          const totalMinutes = (WEEK_END_HOUR - WEEK_START_HOUR) * 60;

          return (
            <div key={colIdx} className="cc-calendar__week-col" style={{ height: `${totalMinutes}px` }}>
              {/* Hour grid lines */}
              {hours.map((h) => (
                <div
                  key={h}
                  className="cc-calendar__time-slot"
                  style={{ top: `${(h - WEEK_START_HOUR) * 60}px` }}
                  onClick={() => onTimeSlotClick(date, h)}
                />
              ))}

              {/* Event blocks */}
              {dayEvents
                .filter((ev) => !ev.is_all_day)
                .map((ev) => (
                  <EventBlock key={ev.id} event={ev} onClick={(e) => onEventClick(ev, e)} />
                ))}

              {/* All-day events pinned at top */}
              {dayEvents
                .filter((ev) => ev.is_all_day)
                .map((ev) => (
                  <button
                    key={ev.id}
                    type="button"
                    className="cc-calendar__event-block cc-calendar__event-block--allday"
                    onClick={(e) => onEventClick(ev, e)}
                    title={ev.title}
                  >
                    <span className="cc-calendar__event-block-title">{ev.title}</span>
                  </button>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
