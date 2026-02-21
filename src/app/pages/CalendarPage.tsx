import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useModuleStore } from '../stores/useModuleStore';
import SegmentedControl from '../components/shared/SegmentedControl';
import EventCreateDialog from '../components/shared/EventCreateDialog';
import type { EventResponse } from '../types/api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const WEEK_START_HOUR = 7;
const WEEK_END_HOUR = 22; // exclusive — last slot is 21:00-22:00

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatTimeLabel(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return '12 PM';
  return `${hour - 12} PM`;
}

/** Get the start of the week (Sunday) for a given date. */
function startOfWeek(d: Date): Date {
  const out = new Date(d);
  out.setDate(out.getDate() - out.getDay());
  out.setHours(0, 0, 0, 0);
  return out;
}

/** Build an array of dates for the month grid (includes leading/trailing days). */
function getMonthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const startDay = first.getDay(); // 0=Sun
  const start = new Date(first);
  start.setDate(start.getDate() - startDay);

  const dates: Date[] = [];
  // Always show 6 rows (42 cells) to keep grid stable
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    dates.push(d);
  }
  return dates;
}

/** Build array of 7 dates for a week starting from `weekStart`. */
function getWeekDates(weekStart: Date): Date[] {
  const dates: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    dates.push(d);
  }
  return dates;
}

/** Index events by date key for fast lookup. */
function indexEventsByDate(events: EventResponse[]): Map<string, EventResponse[]> {
  const map = new Map<string, EventResponse[]>();
  for (const ev of events) {
    const d = new Date(ev.start_time);
    const key = toDateKey(d);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(ev);
  }
  // Sort each bucket by start_time
  for (const bucket of map.values()) {
    bucket.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  }
  return map;
}

/** Compact time display for pills. */
function pillTime(ev: EventResponse): string {
  if (ev.is_all_day) return 'All day';
  const d = new Date(ev.start_time);
  const h = d.getHours();
  const m = d.getMinutes();
  const suffix = h >= 12 ? 'p' : 'a';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, '0')}${suffix}`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** A small colored event pill used in month view. */
function EventPill({
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
    </button>
  );
}

/** Event block in week view — positioned absolutely within a time column. */
function EventBlock({
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

  const startH = start.getHours();
  const startM = start.getMinutes();
  const endH = end.getHours();
  const endM = end.getMinutes();
  const fmtTime = (h: number, m: number) => {
    const suffix = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
  };

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
      <span className="cc-calendar__event-block-title">{event.title}</span>
      <span className="cc-calendar__event-block-time">
        {fmtTime(startH, startM)} - {fmtTime(endH, endM)}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// CalendarPage
// ---------------------------------------------------------------------------

type ViewMode = 'month' | 'week';

export default function CalendarPage() {
  const navigate = useNavigate();
  const events = useModuleStore((s) => s.events);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const [view, setView] = useState<ViewMode>('month');
  const [currentDate, setCurrentDate] = useState(() => new Date(today));

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogDate, setDialogDate] = useState<string | undefined>();
  const [dialogTime, setDialogTime] = useState<string | undefined>();

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // Index events
  const eventsByDate = useMemo(() => indexEventsByDate(events), [events]);

  // Navigation
  const goPrev = useCallback(() => {
    setCurrentDate((d) => {
      const next = new Date(d);
      if (view === 'month') {
        next.setMonth(next.getMonth() - 1);
      } else {
        next.setDate(next.getDate() - 7);
      }
      return next;
    });
  }, [view]);

  const goNext = useCallback(() => {
    setCurrentDate((d) => {
      const next = new Date(d);
      if (view === 'month') {
        next.setMonth(next.getMonth() + 1);
      } else {
        next.setDate(next.getDate() + 7);
      }
      return next;
    });
  }, [view]);

  const goToday = useCallback(() => {
    setCurrentDate(new Date(today));
  }, [today]);

  // Click handlers
  const handleEventClick = useCallback(
    (ev: EventResponse, e: React.MouseEvent) => {
      e.stopPropagation();
      navigate(`/events/${ev.id}`);
    },
    [navigate],
  );

  const handleDayClick = useCallback((date: Date) => {
    setDialogDate(toDateKey(date));
    setDialogTime(undefined);
    setDialogOpen(true);
  }, []);

  const handleTimeSlotClick = useCallback((date: Date, hour: number) => {
    setDialogDate(toDateKey(date));
    setDialogTime(`${String(hour).padStart(2, '0')}:00`);
    setDialogOpen(true);
  }, []);

  // Header label
  const headerLabel =
    view === 'month'
      ? `${MONTH_NAMES[month]} ${year}`
      : (() => {
          const ws = startOfWeek(currentDate);
          const we = new Date(ws);
          we.setDate(we.getDate() + 6);
          if (ws.getMonth() === we.getMonth()) {
            return `${MONTH_NAMES[ws.getMonth()]} ${ws.getDate()} - ${we.getDate()}, ${ws.getFullYear()}`;
          }
          return `${MONTH_NAMES[ws.getMonth()].slice(0, 3)} ${ws.getDate()} - ${MONTH_NAMES[we.getMonth()].slice(0, 3)} ${we.getDate()}, ${we.getFullYear()}`;
        })();

  return (
    <div className="cc-calendar">
      {/* Header */}
      <div className="cc-calendar__header">
        <div className="cc-calendar__header-left">
          <h1 className="cc-page-header__title cc-calendar__title">{headerLabel}</h1>
          <div className="cc-calendar__nav">
            <button type="button" className="cc-btn cc-btn--ghost cc-calendar__nav-btn" onClick={goPrev} aria-label="Previous">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 3L5 8l5 5" />
              </svg>
            </button>
            <button type="button" className="cc-btn cc-btn--ghost cc-calendar__today-btn" onClick={goToday}>
              Today
            </button>
            <button type="button" className="cc-btn cc-btn--ghost cc-calendar__nav-btn" onClick={goNext} aria-label="Next">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 3l5 5-5 5" />
              </svg>
            </button>
          </div>
        </div>
        <div className="cc-calendar__header-right">
          <SegmentedControl
            options={[
              { label: 'Month', value: 'month' },
              { label: 'Week', value: 'week' },
            ]}
            value={view}
            onChange={(v) => setView(v as ViewMode)}
          />
        </div>
      </div>

      {/* Views */}
      {view === 'month' ? (
        <MonthView
          year={year}
          month={month}
          today={today}
          eventsByDate={eventsByDate}
          onDayClick={handleDayClick}
          onEventClick={handleEventClick}
        />
      ) : (
        <WeekView
          currentDate={currentDate}
          today={today}
          eventsByDate={eventsByDate}
          onTimeSlotClick={handleTimeSlotClick}
          onEventClick={handleEventClick}
        />
      )}

      {/* Create dialog */}
      <EventCreateDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initialDate={dialogDate}
        initialTime={dialogTime}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Month View
// ---------------------------------------------------------------------------

const MAX_VISIBLE_PILLS = 3;

function MonthView({
  year,
  month,
  today,
  eventsByDate,
  onDayClick,
  onEventClick,
}: {
  year: number;
  month: number;
  today: Date;
  eventsByDate: Map<string, EventResponse[]>;
  onDayClick: (date: Date) => void;
  onEventClick: (ev: EventResponse, e: React.MouseEvent) => void;
}) {
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

// ---------------------------------------------------------------------------
// Week View
// ---------------------------------------------------------------------------

function WeekView({
  currentDate,
  today,
  eventsByDate,
  onTimeSlotClick,
  onEventClick,
}: {
  currentDate: Date;
  today: Date;
  eventsByDate: Map<string, EventResponse[]>;
  onTimeSlotClick: (date: Date, hour: number) => void;
  onEventClick: (ev: EventResponse, e: React.MouseEvent) => void;
}) {
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
