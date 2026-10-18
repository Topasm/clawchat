import { afterEach, describe, expect, it } from 'vitest';
import { changeAppLanguage } from '../../i18n';
import { dayNames, formatMonthLabel, formatTimeLabel, formatWeekLabel } from '../calendarUtils';

describe('calendar labels', () => {
  afterEach(async () => {
    await changeAppLanguage('en');
  });

  it('reads the week, month, days and hours in English', () => {
    expect(formatWeekLabel(new Date(2030, 2, 10))).toBe('March 10 - 16, 2030');
    expect(formatWeekLabel(new Date(2030, 2, 31))).toBe('Mar 31 - Apr 6, 2030');
    expect(formatMonthLabel(2030, 2)).toBe('March 2030');
    expect(dayNames()[0]).toBe('Sun');
    expect(formatTimeLabel(7)).toBe('7 AM');
  });

  it('reads them the Korean way', async () => {
    await changeAppLanguage('ko');
    expect(formatWeekLabel(new Date(2030, 2, 10))).toBe('2030년 3월 10일 – 16일');
    expect(formatWeekLabel(new Date(2030, 2, 31))).toBe('2030년 3월 31일 – 4월 6일');
    expect(formatWeekLabel(new Date(2030, 11, 29))).toBe('2030년 12월 29일 – 2031년 1월 4일');
    expect(formatMonthLabel(2030, 2)).toBe('2030년 3월');
    expect(dayNames()).toEqual(['일', '월', '화', '수', '목', '금', '토']);
    expect(formatTimeLabel(0)).toBe('오전 12시');
    expect(formatTimeLabel(7)).toBe('오전 7시');
    expect(formatTimeLabel(12)).toBe('오후 12시');
    expect(formatTimeLabel(18)).toBe('오후 6시');
  });
});
