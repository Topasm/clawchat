import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatDate,
  formatTime,
  formatDateTime,
  formatRelativeTime,
  truncate,
  isToday,
  isTomorrow,
  isOverdue,
  formatDueDate,
  getGreeting,
  formatShortDateTime,
} from '../formatters';

describe('formatters', () => {
  describe('formatDate', () => {
    it('formats a date string', () => {
      const result = formatDate('2026-01-15T10:00:00.000Z');
      expect(result).toMatch(/Jan/);
      expect(result).toMatch(/15/);
      expect(result).toMatch(/2026/);
    });
  });

  describe('formatTime', () => {
    it('formats a time string', () => {
      const result = formatTime('2026-01-15T14:30:00.000Z');
      expect(result).toMatch(/\d{1,2}:\d{2}/);
      expect(result).toMatch(/AM|PM/);
    });
  });

  describe('formatDateTime', () => {
    it('combines date and time', () => {
      const result = formatDateTime('2026-01-15T14:30:00.000Z');
      expect(result).toContain(' at ');
    });
  });

  describe('formatRelativeTime', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-22T12:00:00.000Z'));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns "just now" for recent times', () => {
      expect(formatRelativeTime('2026-02-22T11:59:30.000Z')).toBe('just now');
    });

    it('returns minutes ago', () => {
      expect(formatRelativeTime('2026-02-22T11:55:00.000Z')).toBe('5 minutes ago');
    });

    it('returns "1 minute ago" for singular', () => {
      expect(formatRelativeTime('2026-02-22T11:59:00.000Z')).toBe('1 minute ago');
    });

    it('returns hours ago', () => {
      expect(formatRelativeTime('2026-02-22T09:00:00.000Z')).toBe('3 hours ago');
    });

    it('returns "yesterday" for 1 day ago', () => {
      expect(formatRelativeTime('2026-02-21T12:00:00.000Z')).toBe('yesterday');
    });

    it('returns "X days ago" for recent days', () => {
      expect(formatRelativeTime('2026-02-19T12:00:00.000Z')).toBe('3 days ago');
    });

    it('falls back to formatted date for older dates', () => {
      const result = formatRelativeTime('2026-01-15T12:00:00.000Z');
      expect(result).toMatch(/Jan/);
    });
  });

  describe('truncate', () => {
    it('returns text unchanged if within limit', () => {
      expect(truncate('hello', 10)).toBe('hello');
    });

    it('truncates with ellipsis', () => {
      expect(truncate('a very long string here', 10)).toBe('a very lon...');
    });

    it('handles empty string', () => {
      expect(truncate('')).toBe('');
    });

    it('handles null-ish', () => {
      expect(truncate(null as unknown as string)).toBe('');
    });
  });

  describe('date predicates', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-22T12:00:00.000Z'));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('isToday returns true for today', () => {
      expect(isToday('2026-02-22T08:00:00.000Z')).toBe(true);
    });

    it('isToday returns false for other days', () => {
      expect(isToday('2026-02-21T08:00:00.000Z')).toBe(false);
    });

    it('isToday returns false for empty string', () => {
      expect(isToday('')).toBe(false);
    });

    it('isTomorrow returns true for tomorrow', () => {
      expect(isTomorrow('2026-02-23T08:00:00.000Z')).toBe(true);
    });

    it('isTomorrow returns false for today', () => {
      expect(isTomorrow('2026-02-22T08:00:00.000Z')).toBe(false);
    });

    it('isOverdue returns true for past dates', () => {
      expect(isOverdue('2026-02-20T08:00:00.000Z')).toBe(true);
    });

    it('isOverdue returns false for today', () => {
      // isOverdue compares with start of today, so today's date is not overdue
      expect(isOverdue('2026-02-22T08:00:00.000Z')).toBe(false);
    });

  });

  describe('formatDueDate', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-22T12:00:00.000Z'));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns "Today" for today', () => {
      expect(formatDueDate('2026-02-22T08:00:00.000Z')).toBe('Today');
    });

    it('returns "Tomorrow" for tomorrow', () => {
      expect(formatDueDate('2026-02-23T08:00:00.000Z')).toBe('Tomorrow');
    });

    it('returns "Overdue" for past dates', () => {
      expect(formatDueDate('2026-02-20T08:00:00.000Z')).toBe('Overdue');
    });

    it('returns empty string for empty input', () => {
      expect(formatDueDate('')).toBe('');
    });
  });

  describe('getGreeting', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns "Good morning" before noon', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-22T09:00:00'));
      expect(getGreeting()).toBe('Good morning');
    });

    it('returns "Good afternoon" in afternoon', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-22T14:00:00'));
      expect(getGreeting()).toBe('Good afternoon');
    });

    it('returns "Good evening" in evening', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-22T19:00:00'));
      expect(getGreeting()).toBe('Good evening');
    });
  });

  describe('formatShortDateTime', () => {
    it('formats a date string with day and time components', () => {
      const result = formatShortDateTime('2026-01-15T14:30:00.000Z');
      // The output depends on the system locale, so just check it contains the day number
      expect(result).toMatch(/15/);
      // Should contain some time component (colon-separated digits)
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });
  });
});
