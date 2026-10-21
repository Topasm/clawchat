import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import WeekView from '../WeekView';
import { indexEventsByDate } from '../../../utils/calendarUtils';
import type { EventResponse } from '../../../types/api';

function event(id: string, start: Date, isAllDay = false): EventResponse {
  return {
    id,
    title: id,
    start_time: start.toISOString(),
    is_all_day: isAllDay,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  };
}

describe('WeekView', () => {
  it('lists a day’s all-day events first, then the rest by time', () => {
    const day = new Date(2026, 9, 21);
    const at = (hour: number) => new Date(2026, 9, 21, hour);
    const eventsByDate = indexEventsByDate([
      event('Late meeting', at(15)),
      event('Holiday', at(0), true),
      event('Standup', at(9)),
    ]);
    render(
      <WeekView
        currentDate={day}
        today={day}
        eventsByDate={eventsByDate}
        tasksByDate={new Map()}
        onTimeSlotClick={vi.fn()}
        onEventClick={vi.fn()}
        onTaskClick={vi.fn()}
      />,
    );
    const column = screen.getByRole('region', { name: day.toDateString() });
    const titles = within(column)
      .getAllByTitle(/.+/)
      .map((button) => button.getAttribute('title'));
    expect(titles).toEqual(['Holiday', 'Standup', 'Late meeting']);
  });
});
