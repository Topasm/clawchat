import { useState, useCallback } from 'react';
import AiSetupBanner from '../shared/AiSetupBanner';
import { useNavigate } from 'react-router-dom';
import { useToggleTodoComplete } from '../../hooks/queries';
import usePlatform from '../../hooks/usePlatform';
import { useOpenTask, useSelectedTaskId } from '../../hooks/useTaskPane';
import { formatDate } from '../../utils/formatters';
import TaskCard from '../shared/TaskCard';
import AutoApprovedLine from './AutoApprovedLine';
import EventCard from '../shared/EventCard';
import TodaySuggestions from './TodaySuggestions';
import TodayNext from './TodayNext';
import { ChevronRightIcon } from '../shared/Icons';
import { GearIcon, TodayIcon } from '../shared/NavIcons';
import { TodayPageSkeleton, BriefingSkeleton } from '../shared/PageSkeletons';
import type { TodoResponse, EventResponse } from '../../types/api';
import type { BriefingData } from '../../hooks/useTodayBriefing';
import { translateUi } from '../../i18n';
import { settingsNavigationState } from '../../services/settingsNavigation';

interface TodayViewProps {
  todayDate: string;
  todayTasks: TodoResponse[];
  overdueTasks: TodoResponse[];
  todayEvents: EventResponse[];
  isLoading: boolean;
  briefingData: BriefingData | null;
  briefingLoading: boolean;
}

/** How many rows a phone shows before "See all tasks". */
const MOBILE_VISIBLE_TASKS = 6;

/**
 * Today is one line of counts and one list, in the order the day asks for
 * them: what is late, then what is due. Events lead the list on desktop.
 * Suggestions (from the calendar and the briefing) fold into one line above
 * it, and the summary the server writes stays folded until asked for.
 */
export default function TodayView({
  todayDate,
  todayTasks,
  overdueTasks,
  todayEvents,
  isLoading,
  briefingData,
  briefingLoading,
}: TodayViewProps) {
  const navigate = useNavigate();
  const openTask = useOpenTask();
  const selectedTaskId = useSelectedTaskId();
  const toggleMutation = useToggleTodoComplete();
  const { isMobile } = usePlatform();
  const toggleTodoComplete = useCallback(
    (id: string) => {
      const task = [...todayTasks, ...overdueTasks].find((t) => t.id === id);
      if (task) toggleMutation.mutate({ id, currentStatus: task.status });
    },
    [todayTasks, overdueTasks, toggleMutation],
  );
  const [briefingOpen, setBriefingOpen] = useState(false);
  const tasks = [...overdueTasks, ...todayTasks];
  const visibleTasks = isMobile ? tasks.slice(0, MOBILE_VISIBLE_TASKS) : tasks;
  const events = isMobile ? [] : todayEvents;
  const hasAnything = tasks.length > 0 || todayEvents.length > 0;
  const summary = [
    todayTasks.length > 0 ? translateUi('{{count}} left', { count: todayTasks.length }) : null,
    overdueTasks.length > 0
      ? translateUi('{{count}} overdue', { count: overdueTasks.length })
      : null,
    todayEvents.length > 0 ? translateUi('{{count}} events', { count: todayEvents.length }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div>
      <div className="cc-page-header cc-page-header--flush cc-today-header">
        <div>
          <h1 className="cc-page-header__title cc-page-header__title--icon">
            <TodayIcon className="cc-page-header__icon cc-page-header__icon--today" />
            {translateUi('Today')}
          </h1>
          <div className="cc-page-header__subtitle">
            {[todayDate ? formatDate(todayDate) : '', summary].filter(Boolean).join(' · ')}
          </div>
        </div>
        {isMobile && (
          <button
            type="button"
            className="cc-btn cc-btn--ghost cc-btn--icon-touch"
            onClick={() =>
              navigate('/settings/app', {
                state: settingsNavigationState('/schedule/today'),
              })
            }
            aria-label={translateUi('Open settings')}
          >
            <GearIcon />
          </button>
        )}
      </div>

      <AiSetupBanner />
      <AutoApprovedLine />

      <TodaySuggestions briefingSuggestions={briefingData?.suggestions} />

      {isLoading && !hasAnything && <TodayPageSkeleton />}

      {!isLoading && !hasAnything && (
        <>
          <p className="cc-today-empty">{translateUi('Nothing left today')}</p>
          <TodayNext />
        </>
      )}

      {(events.length > 0 || visibleTasks.length > 0) && (
        <div className="cc-today-list">
          {events.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              onClick={() => navigate(`/events/${event.id}`)}
            />
          ))}
          {visibleTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onToggle={() => toggleTodoComplete(task.id)}
              onClick={() => openTask(task.id)}
              selected={task.id === selectedTaskId}
            />
          ))}
        </div>
      )}
      {tasks.length > visibleTasks.length && (
        <button type="button" className="cc-link-btn" onClick={() => navigate('/tasks')}>
          {translateUi('See all tasks')}
        </button>
      )}

      {briefingData && !isMobile && (
        <div className="cc-briefing-collapsible">
          <button
            type="button"
            className="cc-briefing-collapsible__toggle"
            onClick={() => setBriefingOpen(!briefingOpen)}
            aria-expanded={briefingOpen}
          >
            <ChevronRightIcon
              size={16}
              className={`cc-section__chevron${briefingOpen ? ' cc-section__chevron--open' : ''}`}
            />
            <span className="cc-briefing-collapsible__title">{translateUi("Today's summary")}</span>
          </button>
          {briefingOpen && (
            <div className="cc-briefing-card cc-briefing-card--attached">
              <div className="cc-briefing-card__content">{briefingData.summary}</div>
            </div>
          )}
        </div>
      )}
      {briefingLoading && !briefingData && !isMobile && <BriefingSkeleton />}
    </div>
  );
}
