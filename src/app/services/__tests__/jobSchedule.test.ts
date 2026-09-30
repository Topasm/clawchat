import { describe, expect, it } from 'vitest';
import { DEFAULT_SCHEDULE, rruleToSchedule, scheduleToRrule } from '../jobSchedule';

describe('jobSchedule', () => {
  it('builds the rules the server expects', () => {
    expect(scheduleToRrule({ ...DEFAULT_SCHEDULE, frequency: 'daily', time: '18:30' })).toBe(
      'FREQ=DAILY;BYHOUR=18;BYMINUTE=30',
    );
    expect(scheduleToRrule({ ...DEFAULT_SCHEDULE, frequency: 'weekdays', time: '08:05' })).toBe(
      'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=8;BYMINUTE=5',
    );
    expect(scheduleToRrule({ ...DEFAULT_SCHEDULE, frequency: 'weekly', days: ['TH', 'MO'] })).toBe(
      'FREQ=WEEKLY;BYDAY=MO,TH;BYHOUR=9;BYMINUTE=0',
    );
    expect(scheduleToRrule({ ...DEFAULT_SCHEDULE, frequency: 'monthly', dayOfMonth: 31 })).toBe(
      'FREQ=MONTHLY;BYMONTHDAY=28;BYHOUR=9;BYMINUTE=0',
    );
  });

  it('falls back to Monday when a weekly schedule has no days', () => {
    expect(scheduleToRrule({ ...DEFAULT_SCHEDULE, frequency: 'weekly', days: [] })).toBe(
      'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0',
    );
  });

  it('reads its own rules back for editing', () => {
    for (const draft of [
      { ...DEFAULT_SCHEDULE, frequency: 'daily' as const, time: '18:30' },
      {
        ...DEFAULT_SCHEDULE,
        frequency: 'weekdays' as const,
        days: ['MO', 'TU', 'WE', 'TH', 'FR'] as const,
      },
      { ...DEFAULT_SCHEDULE, frequency: 'weekly' as const, days: ['MO', 'TH'] as const },
      { ...DEFAULT_SCHEDULE, frequency: 'monthly' as const, dayOfMonth: 15, time: '07:45' },
    ]) {
      const rule = scheduleToRrule({ ...draft, days: [...draft.days] });
      expect(rruleToSchedule(rule)).toMatchObject({
        frequency: draft.frequency,
        time: draft.time,
      });
    }
  });

  it('leaves rules it did not make to raw editing', () => {
    expect(rruleToSchedule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;BYHOUR=9;BYMINUTE=0')).toBeNull();
    expect(rruleToSchedule('FREQ=MONTHLY;BYMONTHDAY=1,15;BYHOUR=9;BYMINUTE=0')).toBeNull();
  });
});
