/**
 * The schedules the job editor offers, as RRULEs the server understands.
 *
 * The server reads BYHOUR/BYMINUTE as wall-clock time in the job's time zone,
 * so the rule never carries a DTSTART or an offset.
 */

export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type JobFrequency = 'daily' | 'weekdays' | 'weekly' | 'monthly';

export interface JobScheduleDraft {
  frequency: JobFrequency;
  /** "HH:MM", 24-hour. */
  time: string;
  /** For weekly schedules. */
  days: Weekday[];
  /** For monthly schedules, 1-28 so every month has the day. */
  dayOfMonth: number;
}

export const DEFAULT_SCHEDULE: JobScheduleDraft = {
  frequency: 'weekly',
  time: '09:00',
  days: ['MO'],
  dayOfMonth: 1,
};

const WORKDAYS: Weekday[] = ['MO', 'TU', 'WE', 'TH', 'FR'];

function clockParts(time: string): [number, number] {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  const hour = match ? Math.min(23, Number(match[1])) : 9;
  const minute = match ? Math.min(59, Number(match[2])) : 0;
  return [hour, minute];
}

function ordered(days: Weekday[]): Weekday[] {
  return WEEKDAYS.filter((day) => days.includes(day));
}

export function scheduleToRrule(draft: JobScheduleDraft): string {
  const [hour, minute] = clockParts(draft.time);
  const at = `BYHOUR=${hour};BYMINUTE=${minute}`;
  switch (draft.frequency) {
    case 'daily':
      return `FREQ=DAILY;${at}`;
    case 'weekdays':
      return `FREQ=WEEKLY;BYDAY=${WORKDAYS.join(',')};${at}`;
    case 'monthly':
      return `FREQ=MONTHLY;BYMONTHDAY=${Math.min(28, Math.max(1, draft.dayOfMonth))};${at}`;
    case 'weekly': {
      const days = ordered(draft.days);
      return `FREQ=WEEKLY;BYDAY=${(days.length ? days : ['MO']).join(',')};${at}`;
    }
  }
}

function ruleParts(rrule: string): Record<string, string> {
  return Object.fromEntries(
    rrule
      .replace(/^RRULE:/i, '')
      .split(';')
      .map((part) => part.split('='))
      .filter((pair): pair is [string, string] => pair.length === 2)
      .map(([key, value]) => [key.toUpperCase(), value.toUpperCase()]),
  );
}

/** The editor state for a rule, or null when the rule is not one the editor makes. */
export function rruleToSchedule(rrule: string): JobScheduleDraft | null {
  const parts = ruleParts(rrule);
  const hour = Number(parts.BYHOUR ?? '0');
  const minute = Number(parts.BYMINUTE ?? '0');
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || parts.INTERVAL) return null;
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const days = (parts.BYDAY ?? '')
    .split(',')
    .filter((day): day is Weekday => (WEEKDAYS as readonly string[]).includes(day));
  if (parts.FREQ === 'DAILY' && !parts.BYDAY) {
    return { ...DEFAULT_SCHEDULE, frequency: 'daily', time };
  }
  if (parts.FREQ === 'WEEKLY' && days.length) {
    const isWorkweek = ordered(days).join(',') === WORKDAYS.join(',');
    return {
      ...DEFAULT_SCHEDULE,
      frequency: isWorkweek ? 'weekdays' : 'weekly',
      time,
      days: ordered(days),
    };
  }
  if (parts.FREQ === 'MONTHLY' && parts.BYMONTHDAY && !parts.BYMONTHDAY.includes(',')) {
    return {
      ...DEFAULT_SCHEDULE,
      frequency: 'monthly',
      time,
      dayOfMonth: Number(parts.BYMONTHDAY),
    };
  }
  return null;
}

/** The browser's IANA zone, which is what "09:00" means to the person typing it. */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
