import { useState, useMemo, useCallback } from 'react';
import { MONTH_NAMES, startOfWeek, toDateKey } from '../utils/calendarUtils';

export type ViewMode = 'month' | 'week';

export default function useCalendarNavigation() {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const [view, setView] = useState<ViewMode>('month');
  const [currentDate, setCurrentDate] = useState(() => new Date(today));

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogDate, setDialogDate] = useState<string | undefined>();
  const [dialogTime, setDialogTime] = useState<string | undefined>();

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // Navigation
  const goPrev = useCallback(() => {
    setCurrentDate((d) => {
      const next = new Date(d);
      if (view === 'month') {
        next.setMonth(next.getMonth() - 1);
      } else {
        next.setDate(next.getDate() - 7);
      }
      return next;
    });
  }, [view]);

  const goNext = useCallback(() => {
    setCurrentDate((d) => {
      const next = new Date(d);
      if (view === 'month') {
        next.setMonth(next.getMonth() + 1);
      } else {
        next.setDate(next.getDate() + 7);
      }
      return next;
    });
  }, [view]);

  const goToday = useCallback(() => {
    setCurrentDate(new Date(today));
  }, [today]);

  // Click handlers
  const handleDayClick = useCallback((date: Date) => {
    setDialogDate(toDateKey(date));
    setDialogTime(undefined);
    setDialogOpen(true);
  }, []);

  const handleTimeSlotClick = useCallback((date: Date, hour: number) => {
    setDialogDate(toDateKey(date));
    setDialogTime(`${String(hour).padStart(2, '0')}:00`);
    setDialogOpen(true);
  }, []);

  // Header label
  const headerLabel =
    view === 'month'
      ? `${MONTH_NAMES[month]} ${year}`
      : (() => {
          const ws = startOfWeek(currentDate);
          const we = new Date(ws);
          we.setDate(we.getDate() + 6);
          if (ws.getMonth() === we.getMonth()) {
            return `${MONTH_NAMES[ws.getMonth()]} ${ws.getDate()} - ${we.getDate()}, ${ws.getFullYear()}`;
          }
          return `${MONTH_NAMES[ws.getMonth()].slice(0, 3)} ${ws.getDate()} - ${MONTH_NAMES[we.getMonth()].slice(0, 3)} ${we.getDate()}, ${we.getFullYear()}`;
        })();

  return {
    today,
    view,
    setView,
    currentDate,
    year,
    month,
    goPrev,
    goNext,
    goToday,
    handleDayClick,
    handleTimeSlotClick,
    headerLabel,
    dialogOpen,
    setDialogOpen,
    dialogDate,
    dialogTime,
  };
}
