import type { EventResponse, TodoResponse } from '../types/api';
import { translateUi } from '../i18n';
import { isTerminalTaskStatus } from './taskStatus';

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const WEEK_START_HOUR = 7;
export const WEEK_END_HOUR = 22; // exclusive — last slot is 21:00-22:00

export const MAX_VISIBLE_PILLS = 3;

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatTimeLabel(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return '12 PM';
  return `${hour - 12} PM`;
}

/** Get the start of the week (Sunday) for a given date. */
export function startOfWeek(d: Date): Date {
  const out = new Date(d);
  out.setDate(out.getDate() - out.getDay());
  out.setHours(0, 0, 0, 0);
  return out;
}

/** Build an array of dates for the month grid (includes leading/trailing days). */
export function getMonthGrid(year: number, month: number): Date[] {
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
export function getWeekDates(weekStart: Date): Date[] {
  const dates: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    dates.push(d);
  }
  return dates;
}

/** Index events by date key for fast lookup. */
export function indexEventsByDate(events: EventResponse[]): Map<string, EventResponse[]> {
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
export function pillTime(ev: EventResponse): string {
  if (ev.is_all_day) return translateUi('All day');
  const d = new Date(ev.start_time);
  const h = d.getHours();
  const m = d.getMinutes();
  const suffix = h >= 12 ? 'p' : 'a';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, '0')}${suffix}`;
}

/** Where a day falls within the stretch a task runs for. */
export type TaskSegmentPosition = 'start' | 'middle' | 'end' | 'single';

export interface CalendarTaskSegment {
  todo: TodoResponse;
  position: TaskSegmentPosition;
  /** The due date has passed, so the task shows on that day alone. */
  isOverdue: boolean;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Spread every open task with a due date across the days it runs for.
 *
 * This workspace is task-oriented: a due date is a deadline to work towards,
 * not an appointment. So a task occupies the whole stretch left to finish it,
 * from today through its due date. An overdue task has no stretch left and
 * sits on the day it was due.
 */
export function indexTasksByDate(
  todos: TodoResponse[],
  today: Date,
): Map<string, CalendarTaskSegment[]> {
  const map = new Map<string, CalendarTaskSegment[]>();
  const todayStart = startOfDay(today);

  for (const todo of todos) {
    if (!todo.due_date || isTerminalTaskStatus(todo.status)) continue;
    const due = new Date(todo.due_date);
    if (Number.isNaN(due.getTime())) continue;

    const dueStart = startOfDay(due);
    const isOverdue = dueStart.getTime() < todayStart.getTime();
    const from = isOverdue ? dueStart : todayStart;

    const days: string[] = [];
    for (const cursor = new Date(from); cursor <= dueStart; cursor.setDate(cursor.getDate() + 1)) {
      days.push(toDateKey(cursor));
    }

    days.forEach((key, index) => {
      let position: TaskSegmentPosition = 'middle';
      if (days.length === 1) position = 'single';
      else if (index === 0) position = 'start';
      else if (index === days.length - 1) position = 'end';

      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({ todo, position, isOverdue });
    });
  }

  // Soonest deadline first, so the most urgent bar stays visible when a day
  // holds more tasks than the cell can show.
  for (const bucket of map.values()) {
    bucket.sort((a, b) => {
      const byDue = new Date(a.todo.due_date!).getTime() - new Date(b.todo.due_date!).getTime();
      return byDue !== 0 ? byDue : a.todo.title.localeCompare(b.todo.title);
    });
  }
  return map;
}
