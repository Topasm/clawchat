import { describe, expect, it } from 'vitest';
import { parseNaturalInput } from '../naturalLanguageParser';

describe('one-off task capture', () => {
  it.each([
    'every day',
    'every weekday',
    'every Monday',
    'every week',
    'every month',
    'daily',
    'weekly',
  ])('keeps %s in task titles without enabling repetition', (phrase) => {
    const text = `Write report ${phrase}`;
    expect(parseNaturalInput(text)).toMatchObject({
      title: text,
      type: 'task',
      recurrenceRule: null,
    });
  });

  it('keeps due-date parsing for one-off tasks', () => {
    const parsed = parseNaturalInput('Write daily report tomorrow');
    expect(parsed.title).toBe('Write daily report');
    expect(parsed.dueDate).not.toBeNull();
    expect(parsed.recurrenceRule).toBeNull();
  });

  it('preserves calendar event recurrence', () => {
    expect(parseNaturalInput('Team meeting every Monday')).toMatchObject({
      title: 'Team meeting',
      type: 'event',
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
    });
  });
});
