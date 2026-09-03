import { useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEventsQuery, useTodosQuery } from '../../hooks/queries';
import useCalendarNavigation from '../../hooks/useCalendarNavigation';
import { indexEventsByDate, indexTasksByDate } from '../../utils/calendarUtils';
import type { EventResponse, TodoResponse } from '../../types/api';
import CalendarCreateDialog from '../shared/CalendarCreateDialog';
import CalendarHeader from './CalendarHeader';
import MonthView from './MonthView';
import WeekView from './WeekView';

interface CalendarContainerProps {
  initialView?: 'week' | 'month';
  showViewToggle?: boolean;
}

export default function CalendarContainer({
  initialView = 'month',
  showViewToggle = true,
}: CalendarContainerProps = {}) {
  const navigate = useNavigate();
  const { data: events = [] } = useEventsQuery();
  const { data: todos = [] } = useTodosQuery();

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
  } = useCalendarNavigation(initialView);

  const eventsByDate = useMemo(() => indexEventsByDate(events), [events]);
  const tasksByDate = useMemo(() => indexTasksByDate(todos, today), [todos, today]);

  const handleEventClick = useCallback(
    (ev: EventResponse, e: React.MouseEvent) => {
      e.stopPropagation();
      navigate(`/events/${ev.id}`);
    },
    [navigate],
  );

  const handleTaskClick = useCallback(
    (todo: TodoResponse, e: React.MouseEvent) => {
      e.stopPropagation();
      navigate(`/tasks/${todo.id}`);
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
        showViewToggle={showViewToggle}
      />

      {view === 'month' ? (
        <MonthView
          year={year}
          month={month}
          today={today}
          eventsByDate={eventsByDate}
          tasksByDate={tasksByDate}
          onDayClick={handleDayClick}
          onEventClick={handleEventClick}
          onTaskClick={handleTaskClick}
        />
      ) : (
        <WeekView
          currentDate={currentDate}
          today={today}
          eventsByDate={eventsByDate}
          tasksByDate={tasksByDate}
          onTimeSlotClick={handleTimeSlotClick}
          onEventClick={handleEventClick}
          onTaskClick={handleTaskClick}
        />
      )}

      <CalendarCreateDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initialDate={dialogDate}
      />
    </div>
  );
}
