import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToggleTodoComplete, useUpdateTodo } from '../../hooks/queries';
import usePlatform from '../../hooks/usePlatform';
import { formatDate } from '../../utils/formatters';
import SectionHeader from '../shared/SectionHeader';
import TaskCard from '../shared/TaskCard';
import EventCard from '../shared/EventCard';
import EmptyState from '../shared/EmptyState';
import Badge from '../shared/Badge';
import {
  SparkleIcon,
  ClipboardIcon,
  InboxTrayIcon,
  FlameIcon,
  CalendarIcon,
  CheckCircleIcon,
  SpinArrowsIcon,
  ChevronRightIcon,
} from '../shared/Icons';
import { GearIcon } from '../shared/NavIcons';
import { TodayPageSkeleton, BriefingSkeleton } from '../shared/PageSkeletons';
import type { TodoResponse, EventResponse } from '../../types/api';
import type { BriefingData } from '../../hooks/useTodayBriefing';
import { translateUi } from '../../i18n';
import { settingsNavigationState } from '../../services/settingsNavigation';
interface TodayViewProps {
  greeting: string;
  todayDate: string;
  todayTasks: TodoResponse[];
  overdueTasks: TodoResponse[];
  todayEvents: EventResponse[];
  inboxCount: number;
  isLoading: boolean;
  progress: {
    completed: number;
    total: number;
    percentage: number;
    allDone: boolean;
  };
  streakCount: number;
  briefingData: BriefingData | null;
  briefingLoading: boolean;
  needsReviewItems: TodoResponse[];
}
export default function TodayView({
  greeting,
  todayDate,
  todayTasks,
  overdueTasks,
  todayEvents,
  inboxCount,
  isLoading,
  progress,
  streakCount,
  briefingData,
  briefingLoading,
  needsReviewItems,
}: TodayViewProps) {
  const navigate = useNavigate();
  const toggleMutation = useToggleTodoComplete();
  const updateTodoMutation = useUpdateTodo();
  const { isMobile } = usePlatform();
  const toggleTodoComplete = useCallback(
    (id: string) => {
      // Find the task status from the props to determine the toggle direction
      const task = [...todayTasks, ...overdueTasks].find((t) => t.id === id);
      if (task) toggleMutation.mutate({ id, currentStatus: task.status });
    },
    [todayTasks, overdueTasks, toggleMutation],
  );
  const [briefingOpen, setBriefingOpen] = useState(false);
  const totalTasks = todayTasks.length + overdueTasks.length;
  const hasAnything = totalTasks > 0 || todayEvents.length > 0 || needsReviewItems.length > 0;
  const visibleOverdueTasks = isMobile ? overdueTasks.slice(0, 3) : overdueTasks;
  const visibleTodayTasks = isMobile ? todayTasks.slice(0, 4) : todayTasks;
  return (
    <div>
      {/* Header */}
      <div className="cc-page-header cc-today-header">
        <div>
          <div className="cc-page-header__title">{greeting || translateUi('Hello')}</div>
          <div className="cc-page-header__subtitle">
            {todayDate ? formatDate(todayDate) : ''}
            {!isMobile &&
              totalTasks > 0 &&
              ` \u00B7 ${totalTasks} task${totalTasks !== 1 ? 's' : ''} for today`}
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

      {/* Progress bar */}
      {progress.total > 0 && (
        <div className="cc-today-progress">
          <div className="cc-today-progress__header">
            <span className="cc-today-progress__label">
              {progress.allDone
                ? translateUi('\u2705 All done!')
                : isMobile
                  ? translateUi('{{completed}}/{{total}} done today', {
                      completed: progress.completed,
                      total: progress.total,
                    })
                  : translateUi("Today's Progress: {{completed}}/{{total}} tasks", {
                      completed: progress.completed,
                      total: progress.total,
                    })}
            </span>
            {!isMobile && streakCount > 0 && (
              <span className="cc-today-progress__streak">
                <FlameIcon size={14} /> {streakCount}
                {translateUi(' day streak\n              ')}
              </span>
            )}
          </div>
          <div className="cc-today-progress__track">
            <div
              className={`cc-today-progress__bar${progress.allDone ? ' cc-today-progress__bar--complete' : ''}`}
              style={{ width: `${progress.percentage}%` }}
            />
          </div>
        </div>
      )}

      {progress.total === 0 && !isLoading && hasAnything && !isMobile && (
        <div className="cc-today-progress">
          <span className="cc-today-progress__label">{translateUi('No tasks for today')}</span>
        </div>
      )}

      {/* Loading state */}
      {isLoading && !hasAnything && <TodayPageSkeleton />}

      {/* Empty state */}
      {!isLoading && !hasAnything && (
        <EmptyState
          icon={<SparkleIcon size={20} />}
          message={
            isMobile
              ? translateUi('Nothing urgent right now.')
              : translateUi('All clear! Nothing scheduled for today.')
          }
        />
      )}

      {/* Section 1: Overdue tasks (red accent, urgent feel) */}
      {overdueTasks.length > 0 && (
        <SectionHeader
          title={translateUi('Overdue')}
          count={overdueTasks.length}
          variant="warning"
          defaultOpen
        >
          {visibleOverdueTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onToggle={() => toggleTodoComplete(task.id)}
              onClick={() => navigate(`/tasks/${task.id}`)}
            />
          ))}
          {isMobile && overdueTasks.length > visibleOverdueTasks.length && (
            <button type="button" className="cc-link-btn" onClick={() => navigate('/tasks')}>
              {translateUi('\n              See all overdue\n            ')}
            </button>
          )}
        </SectionHeader>
      )}

      {/* Section 2: Today's tasks */}
      {todayTasks.length > 0 && (
        <SectionHeader title={translateUi("Today's Tasks")} count={todayTasks.length} defaultOpen>
          {visibleTodayTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onToggle={() => toggleTodoComplete(task.id)}
              onClick={() => navigate(`/tasks/${task.id}`)}
            />
          ))}
          {isMobile && todayTasks.length > visibleTodayTasks.length && (
            <button type="button" className="cc-link-btn" onClick={() => navigate('/tasks')}>
              {translateUi('\n              See all tasks\n            ')}
            </button>
          )}
        </SectionHeader>
      )}

      {/* Section 3: Needs review from Inbox */}
      {needsReviewItems.length > 0 && (
        <div className="cc-needs-review">
          <div className="cc-needs-review__header">
            <InboxTrayIcon size={16} />
            <span className="cc-needs-review__title">{translateUi('Needs review')}</span>
            <span className="cc-section__count">{needsReviewItems.length}</span>
          </div>
          <div className="cc-needs-review__list">
            {needsReviewItems.map((item) => (
              <div
                key={item.id}
                className="cc-needs-review__item"
                onClick={() => navigate(`/tasks/${item.id}`)}
              >
                <div className="cc-needs-review__item-body">
                  <span className="cc-needs-review__item-title">{item.title}</span>
                  <Badge variant="status">
                    {item.inbox_state === 'plan_ready'
                      ? translateUi('Review plan')
                      : translateUi('Review suggestion')}
                  </Badge>
                </div>
                <button
                  type="button"
                  className="cc-btn cc-btn--ghost cc-needs-review__action"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/tasks/${item.id}`);
                  }}
                >
                  {translateUi('\n                  Review\n                ')}
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="cc-link-btn" onClick={() => navigate('/inbox')}>
            {translateUi('\n            View all in Inbox &rarr;\n          ')}
          </button>
        </div>
      )}

      {/* Inbox banner (when no detailed review items but there are inbox items) */}
      {needsReviewItems.length === 0 && inboxCount > 0 && !isMobile && (
        <div className="cc-inbox-banner" onClick={() => navigate('/inbox')}>
          <InboxTrayIcon size={16} />
          <span className="cc-inbox-banner__text">
            {inboxCount}
            {translateUi(' item')}
            {inboxCount !== 1 ? 's' : ''}
            {translateUi(' in your inbox\n          ')}
          </span>
        </div>
      )}

      {/* Events section (moved below task sections) */}
      {todayEvents.length > 0 && !isMobile && (
        <SectionHeader title={translateUi('Events')} count={todayEvents.length} variant="accent">
          {todayEvents.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              onClick={() => navigate(`/events/${event.id}`)}
            />
          ))}
        </SectionHeader>
      )}

      {/* Daily Briefing (collapsed section at bottom) */}
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
            <ClipboardIcon size={16} />
            <span className="cc-briefing-collapsible__title">{translateUi('Daily Briefing')}</span>
            {briefingData.load_assessment && (
              <span
                className={`cc-briefing-pill cc-briefing-collapsible__assessment cc-briefing-pill--${briefingData.load_assessment === 'heavy' ? 'warning' : briefingData.load_assessment === 'moderate' ? 'task' : 'event'}`}
              >
                {briefingData.load_assessment}
              </span>
            )}
            {Object.values(briefingData.stats).some((v) => v > 0) && (
              <span className="cc-briefing-collapsible__badge">
                {briefingData.stats.events +
                  briefingData.stats.tasks_due +
                  briefingData.stats.overdue}{' '}
                {translateUi('\n                items\n              ')}
              </span>
            )}
          </button>
          {briefingOpen && (
            <div className="cc-briefing-card cc-briefing-card--attached">
              {Object.values(briefingData.stats).some((v) => v > 0) && (
                <div className="cc-briefing-card__stats">
                  {briefingData.stats.events > 0 && (
                    <span className="cc-briefing-pill cc-briefing-pill--event">
                      <CalendarIcon size={13} /> {briefingData.stats.events}
                      {translateUi(' event\n                      ')}
                      {briefingData.stats.events !== 1 ? 's' : ''}
                    </span>
                  )}
                  {briefingData.stats.tasks_due > 0 && (
                    <span className="cc-briefing-pill cc-briefing-pill--task">
                      <CheckCircleIcon size={13} /> {briefingData.stats.tasks_due}
                      {translateUi(' due\n                    ')}
                    </span>
                  )}
                  {briefingData.stats.overdue > 0 && (
                    <span className="cc-briefing-pill cc-briefing-pill--warning">
                      <FlameIcon size={13} /> {briefingData.stats.overdue}
                      {translateUi(' overdue\n                    ')}
                    </span>
                  )}
                  {briefingData.stats.in_progress > 0 && (
                    <span className="cc-briefing-pill cc-briefing-pill--progress">
                      <SpinArrowsIcon size={13} /> {briefingData.stats.in_progress}
                      {translateUi(' in progress\n                    ')}
                    </span>
                  )}
                  {briefingData.stats.inbox > 0 && (
                    <span className="cc-briefing-pill cc-briefing-pill--inbox">
                      <InboxTrayIcon size={13} /> {briefingData.stats.inbox}
                      {translateUi(' inbox\n                    ')}
                    </span>
                  )}
                </div>
              )}
              <div className="cc-briefing-card__content">{briefingData.summary}</div>
              {briefingData.suggestions && briefingData.suggestions.length > 0 && (
                <div className="cc-briefing-card__suggestions">
                  {briefingData.suggestions.map((s, i) => (
                    <div key={i} className="cc-briefing-card__suggestion">
                      <span className="cc-briefing-card__suggestion-text">
                        <strong>{s.title}</strong>{' '}
                        <span className="cc-briefing-card__suggestion-reason">{s.reason}</span>
                      </span>
                      {s.action === 'move_to_tomorrow' && (
                        <button
                          type="button"
                          className="cc-btn cc-btn--compact cc-btn--ghost"
                          onClick={() => {
                            const tomorrow = new Date();
                            tomorrow.setDate(tomorrow.getDate() + 1);
                            tomorrow.setHours(23, 59, 0, 0);
                            updateTodoMutation.mutate({
                              id: s.todo_id,
                              data: { due_date: tomorrow.toISOString() },
                            });
                          }}
                        >
                          {translateUi(
                            '\n                          Move to tomorrow\n                        ',
                          )}
                        </button>
                      )}
                      {s.action === 'start_with' && (
                        <button
                          type="button"
                          className="cc-btn cc-btn--compact cc-btn--ghost"
                          onClick={() => navigate(`/tasks/${s.todo_id}`)}
                        >
                          {translateUi(
                            '\n                          Start\n                        ',
                          )}
                        </button>
                      )}
                      {s.action === 'reschedule' && (
                        <button
                          type="button"
                          className="cc-btn cc-btn--compact cc-btn--ghost"
                          onClick={() => navigate(`/tasks/${s.todo_id}`)}
                        >
                          {translateUi(
                            '\n                          Reschedule\n                        ',
                          )}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {briefingLoading && !briefingData && <BriefingSkeleton />}
    </div>
  );
}
