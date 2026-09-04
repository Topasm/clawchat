import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import SchedulePage from '../SchedulePage';

vi.mock('../../components/today-views/TodayContainer', () => ({
  default: () => <div>Today content</div>,
}));

vi.mock('../../components/calendar-views/CalendarContainer', () => ({
  default: ({ initialView }: { initialView: string }) => <div>{initialView} content</div>,
}));

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

function renderSchedule(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/schedule/:view" element={<SchedulePage />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe('SchedulePage', () => {
  it('moves from today to week to month with left swipes', () => {
    const { container } = renderSchedule('/schedule/today');
    const schedule = container.querySelector('.cc-schedule');
    expect(schedule).not.toBeNull();

    fireEvent.touchStart(schedule!, { touches: [{ clientX: 240, clientY: 100 }] });
    fireEvent.touchEnd(schedule!, { changedTouches: [{ clientX: 120, clientY: 105 }] });
    expect(screen.getByTestId('location')).toHaveTextContent('/schedule/week');
    expect(screen.getByText('week content')).toBeInTheDocument();

    fireEvent.touchStart(schedule!, { touches: [{ clientX: 240, clientY: 100 }] });
    fireEvent.touchEnd(schedule!, { changedTouches: [{ clientX: 120, clientY: 105 }] });
    expect(screen.getByTestId('location')).toHaveTextContent('/schedule/month');
    expect(screen.getByText('month content')).toBeInTheDocument();
  });

  it('moves backward and supports direct view selection', () => {
    renderSchedule('/schedule/month');

    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/schedule/today');
    expect(screen.getByText('Today content')).toBeInTheDocument();
  });

  it('redirects unknown schedule views to today', () => {
    renderSchedule('/schedule/agenda');
    expect(screen.getByTestId('location')).toHaveTextContent('/schedule/today');
  });
});
