import { useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useModuleStore } from '../../stores/useModuleStore';
import useCalendarNavigation from '../../hooks/useCalendarNavigation';
import { indexEventsByDate } from '../../utils/calendarUtils';
import type { EventResponse } from '../../types/api';
import EventCreateDialog from '../shared/EventCreateDialog';
import CalendarHeader from './CalendarHeader';
import MonthView from './MonthView';
import WeekView from './WeekView';

export default function CalendarContainer() {
  const navigate = useNavigate();
  const events = useModuleStore((s) => s.events);

  const {
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
  } = useCalendarNavigation();

  const eventsByDate = useMemo(() => indexEventsByDate(events), [events]);

  const handleEventClick = useCallback(
    (ev: EventResponse, e: React.MouseEvent) => {
      e.stopPropagation();
      navigate(`/events/${ev.id}`);
    },
    [navigate],
  );

  return (
    <div className="cc-calendar">
      <CalendarHeader
        headerLabel={headerLabel}
        view={view}
        onViewChange={setView}
        onPrev={goPrev}
        onNext={goNext}
        onToday={goToday}
      />

      {view === 'month' ? (
        <MonthView
          year={year}
          month={month}
          today={today}
          eventsByDate={eventsByDate}
          onDayClick={handleDayClick}
          onEventClick={handleEventClick}
        />
      ) : (
        <WeekView
          currentDate={currentDate}
          today={today}
          eventsByDate={eventsByDate}
          onTimeSlotClick={handleTimeSlotClick}
          onEventClick={handleEventClick}
        />
      )}

      <EventCreateDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initialDate={dialogDate}
        initialTime={dialogTime}
      />
    </div>
  );
}
