import { translateUi } from '../../i18n';
import { rruleToSchedule, type Weekday } from '../../services/jobSchedule';

const WEEKDAY_LABELS: Record<Weekday, string> = {
  MO: 'Mon',
  TU: 'Tue',
  WE: 'Wed',
  TH: 'Thu',
  FR: 'Fri',
  SA: 'Sat',
  SU: 'Sun',
};

export function weekdayLabel(day: Weekday): string {
  return translateUi(WEEKDAY_LABELS[day]);
}

/** A sentence for a job's rule, e.g. "Every Mon, Thu at 09:00". */
export function describeSchedule(rrule: string): string {
  const schedule = rruleToSchedule(rrule);
  if (!schedule) return translateUi('Custom schedule: {{rule}}', { rule: rrule });
  const time = schedule.time;
  switch (schedule.frequency) {
    case 'daily':
      return translateUi('Every day at {{time}}', { time });
    case 'weekdays':
      return translateUi('Weekdays at {{time}}', { time });
    case 'monthly':
      return translateUi('Monthly on day {{day}} at {{time}}', {
        day: schedule.dayOfMonth,
        time,
      });
    case 'weekly':
      return translateUi('Every {{days}} at {{time}}', {
        days: schedule.days.map(weekdayLabel).join(', '),
        time,
      });
  }
}
