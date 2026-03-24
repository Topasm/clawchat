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
import { SparkleIcon, ClipboardIcon, InboxTrayIcon, FlameIcon, CalendarIcon, CheckCircleIcon, SpinArrowsIcon } from '../shared/Icons';
import { GearIcon } from '../shared/NavIcons';
import { TodayPageSkeleton, BriefingSkeleton } from '../shared/PageSkeletons';
import type { TodoResponse, EventResponse } from '../../types/api';
import type { BriefingData } from '../../hooks/useTodayBriefing';

interface TodayViewProps {
  greeting: string;
  todayDate: string;
  todayTasks: TodoResponse[];
  overdueTasks: TodoResponse[];
  todayEvents: EventResponse[];
  inboxCount: number;
  isLoading: boolean;
  progress: { completed: number; total: number; percentage: number; allDone: boolean };
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

  const toggleTodoComplete = useCallback((id: string) => {
    // Find the task status from the props to determine the toggle direction
    const task = [...todayTasks, ...overdueTasks].find((t) => t.id === id);
    if (task) toggleMutation.mutate({ id, currentStatus: task.status });
  }, [todayTasks, overdueTasks, toggleMutation]);
  const [briefingOpen, setBriefingOpen] = useState(false);

  const totalTasks = todayTasks.length + overdueTasks.length;
  const hasAnything = totalTasks > 0 || todayEvents.length > 0 || needsReviewItems.length > 0;
  const visibleOverdueTasks = isMobile ? overdueTasks.slice(0, 3) : overdueTasks;
  const visibleTodayTasks = isMobile ? todayTasks.slice(0, 4) : todayTasks;

  return (
    <div>
      {/* Header */}
      <div className="cc-page-header" style={isMobile ? { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 } : undefined}>
        <div>
          <div className="cc-page-header__title">{greeting || 'Hello'}</div>
          <div className="cc-page-header__subtitle">
            {todayDate ? formatDate(todayDate) : ''}
            {!isMobile && totalTasks > 0 && ` \u00B7 ${totalTasks} task${totalTasks !== 1 ? 's' : ''} for today`}
          </div>
        </div>
        {isMobile && (
          <button
            type="button"
            className="cc-btn cc-btn--ghost"
            onClick={() => navigate('/settings')}
            aria-label="Open settings"
            style={{ minWidth: 44, minHeight: 44, padding: 10 }}
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
                ? '\u2705 All done!'
                : isMobile
                  ? `${progress.completed}/${progress.total} done today`
                  : `Today\u2019s Progress: ${progress.completed}/${progress.total} tasks`}
            </span>
            {!isMobile && streakCount > 0 && (
              <span className="cc-today-progress__streak">
                <FlameIcon size={14} /> {streakCount} day streak
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
          <span className="cc-today-progress__label">No tasks for today</span>
        </div>
      )}

      {/* Loading state */}
      {isLoading && !hasAnything && <TodayPageSkeleton />}

      {/* Empty state */}
      {!isLoading && !hasAnything && (
        <EmptyState icon={<SparkleIcon size={20} />} message={isMobile ? 'Nothing urgent right now.' : 'All clear! Nothing scheduled for today.'} />
      )}

      {/* Section 1: Overdue tasks (red accent, urgent feel) */}
      {overdueTasks.length > 0 && (
        <SectionHeader title="Overdue" count={overdueTasks.length} variant="warning" defaultOpen>
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
              See all overdue
            </button>
          )}
        </SectionHeader>
      )}

      {/* Section 2: Today's tasks */}
      {todayTasks.length > 0 && (
        <SectionHeader title="Today's Tasks" count={todayTasks.length} defaultOpen>
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
              See all tasks
            </button>
          )}
        </SectionHeader>
      )}

      {/* Section 3: Needs review from Inbox */}
      {needsReviewItems.length > 0 && (
        <div className="cc-needs-review">
          <div className="cc-needs-review__header">
            <InboxTrayIcon size={16} />
            <span className="cc-needs-review__title">Needs review</span>
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
                    {item.inbox_state === 'plan_ready' ? 'Review plan' : 'Review suggestion'}
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
                  Review
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="cc-link-btn"
            onClick={() => navigate('/inbox')}
          >
            View all in Inbox &rarr;
          </button>
        </div>
      )}

      {/* Inbox banner (when no detailed review items but there are inbox items) */}
      {needsReviewItems.length === 0 && inboxCount > 0 && !isMobile && (
        <div className="cc-inbox-banner" onClick={() => navigate('/inbox')}>
          <InboxTrayIcon size={16} />
          <span className="cc-inbox-banner__text">
            {inboxCount} item{inboxCount !== 1 ? 's' : ''} in your inbox
          </span>
        </div>
      )}

      {/* Events section (moved below task sections) */}
      {todayEvents.length > 0 && !isMobile && (
        <SectionHeader title="Events" count={todayEvents.length} variant="accent">
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
          >
            <svg
              className={`cc-section__chevron${briefingOpen ? ' cc-section__chevron--open' : ''}`}
              viewBox="0 0 16 16"
              fill="none"
            >
              <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <ClipboardIcon size={16} />
            <span className="cc-briefing-collapsible__title">Daily Briefing</span>
            {briefingData.load_assessment && (
              <span className={`cc-briefing-pill cc-briefing-pill--${briefingData.load_assessment === 'heavy' ? 'warning' : briefingData.load_assessment === 'moderate' ? 'task' : 'event'}`} style={{ marginLeft: 8, fontSize: 11 }}>
                {briefingData.load_assessment}
              </span>
            )}
            {Object.values(briefingData.stats).some(v => v > 0) && (
              <span className="cc-briefing-collapsible__badge">
                {briefingData.stats.events + briefingData.stats.tasks_due + briefingData.stats.overdue} items
              </span>
            )}
          </button>
          {briefingOpen && (
            <div className="cc-briefing-card" style={{ marginTop: 0, borderTop: 'none', borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
              {Object.values(briefingData.stats).some(v => v > 0) && (
                <div className="cc-briefing-card__stats">
                  {briefingData.stats.events > 0 && (
                    <span className="cc-briefing-pill cc-briefing-pill--event">
                      <CalendarIcon size={13} /> {briefingData.stats.events} event{briefingData.stats.events !== 1 ? 's' : ''}
                    </span>
                  )}
                  {briefingData.stats.tasks_due > 0 && (
                    <span className="cc-briefing-pill cc-briefing-pill--task">
                      <CheckCircleIcon size={13} /> {briefingData.stats.tasks_due} due
                    </span>
                  )}
                  {briefingData.stats.overdue > 0 && (
                    <span className="cc-briefing-pill cc-briefing-pill--warning">
                      <FlameIcon size={13} /> {briefingData.stats.overdue} overdue
                    </span>
                  )}
                  {briefingData.stats.in_progress > 0 && (
                    <span className="cc-briefing-pill cc-briefing-pill--progress">
                      <SpinArrowsIcon size={13} /> {briefingData.stats.in_progress} in progress
                    </span>
                  )}
                  {briefingData.stats.inbox > 0 && (
                    <span className="cc-briefing-pill cc-briefing-pill--inbox">
                      <InboxTrayIcon size={13} /> {briefingData.stats.inbox} inbox
                    </span>
                  )}
                </div>
              )}
              <div className="cc-briefing-card__content">{briefingData.summary}</div>
              {briefingData.suggestions && briefingData.suggestions.length > 0 && (
                <div className="cc-briefing-card__suggestions" style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {briefingData.suggestions.map((s, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, background: 'var(--cc-color-surface-raised, rgba(255,255,255,0.06))' }}>
                      <span style={{ flex: 1, fontSize: 13 }}>
                        <strong>{s.title}</strong>{' '}
                        <span style={{ opacity: 0.7 }}>{s.reason}</span>
                      </span>
                      {s.action === 'move_to_tomorrow' && (
                        <button
                          type="button"
                          className="cc-btn cc-btn--sm cc-btn--ghost"
                          onClick={() => {
                            const tomorrow = new Date();
                            tomorrow.setDate(tomorrow.getDate() + 1);
                            tomorrow.setHours(23, 59, 0, 0);
                            updateTodoMutation.mutate({ id: s.todo_id, data: { due_date: tomorrow.toISOString() } });
                          }}
                        >
                          Move to tomorrow
                        </button>
                      )}
                      {s.action === 'start_with' && (
                        <button
                          type="button"
                          className="cc-btn cc-btn--sm cc-btn--ghost"
                          onClick={() => navigate(`/tasks/${s.todo_id}`)}
                        >
                          Start
                        </button>
                      )}
                      {s.action === 'reschedule' && (
                        <button
                          type="button"
                          className="cc-btn cc-btn--sm cc-btn--ghost"
                          onClick={() => navigate(`/tasks/${s.todo_id}`)}
                        >
                          Reschedule
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
