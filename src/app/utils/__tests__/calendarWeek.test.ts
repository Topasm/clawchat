import { describe, expect, it } from 'vitest';
import { endOfWeek, isDueThisWeek, startOfWeek } from '../calendarUtils';

describe('this week, as the week view draws it', () => {
  // Thursday 2030-03-14, local time.
  const now = new Date(2030, 2, 14, 9, 0, 0);

  it('ends on Saturday night of the same Sun–Sat week', () => {
    expect(startOfWeek(now).getDay()).toBe(0);
    const end = endOfWeek(now);
    expect(end.getDay()).toBe(6);
    expect(end.getDate()).toBe(16);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
  });

  it('counts what is due before Saturday night, not a rolling seven days', () => {
    expect(isDueThisWeek(new Date(2030, 2, 14, 18).toISOString(), now)).toBe(true);
    expect(isDueThisWeek(new Date(2030, 2, 16, 23, 59).toISOString(), now)).toBe(true);
    // Next Monday is within seven days but belongs to the next week view.
    expect(isDueThisWeek(new Date(2030, 2, 18, 9).toISOString(), now)).toBe(false);
    // Already due is not "coming up this week".
    expect(isDueThisWeek(new Date(2030, 2, 13, 9).toISOString(), now)).toBe(false);
    expect(isDueThisWeek('not a date', now)).toBe(false);
  });
});
