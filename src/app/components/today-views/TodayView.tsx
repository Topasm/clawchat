import { useNavigate } from 'react-router-dom';
import { useModuleStore } from '../../stores/useModuleStore';
import { formatDate } from '../../utils/formatters';
import SectionHeader from '../shared/SectionHeader';
import TaskCard from '../shared/TaskCard';
import EventCard from '../shared/EventCard';
import EmptyState from '../shared/EmptyState';
import QuickCaptureModal from '../shared/QuickCaptureModal';
import { TodayPageSkeleton, BriefingSkeleton } from '../shared/PageSkeletons';
import type { TodoResponse, EventResponse } from '../../types/api';

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
  briefing: string | null;
  briefingLoading: boolean;
  showCapture: boolean;
  onCloseCapture: () => void;
  capturePlaceholder: string;
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
  briefing,
  briefingLoading,
  showCapture,
  onCloseCapture,
  capturePlaceholder,
}: TodayViewProps) {
  const navigate = useNavigate();
  const toggleTodoComplete = useModuleStore((s) => s.toggleTodoComplete);

  const totalTasks = todayTasks.length + overdueTasks.length;
  const hasAnything = totalTasks > 0 || todayEvents.length > 0;

  return (
    <div>
      <div className="cc-page-header">
        <div className="cc-page-header__title">{greeting || 'Hello'}</div>
        <div className="cc-page-header__subtitle">
          {todayDate ? formatDate(todayDate) : ''}
          {totalTasks > 0 && ` \u00B7 ${totalTasks} task${totalTasks !== 1 ? 's' : ''} for today`}
        </div>
      </div>

      <QuickCaptureModal
        isOpen={showCapture}
        onClose={onCloseCapture}
        placeholder={capturePlaceholder}
      />

      {progress.total > 0 && (
        <div className="cc-today-progress">
          <div className="cc-today-progress__header">
            <span className="cc-today-progress__label">
              {progress.allDone
                ? '\u2705 All done!'
                : `Today\u2019s Progress: ${progress.completed}/${progress.total} tasks`}
            </span>
            {streakCount > 0 && (
              <span className="cc-today-progress__streak">
                {'\uD83D\uDD25'} {streakCount} day streak
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

      {progress.total === 0 && !isLoading && hasAnything && (
        <div className="cc-today-progress">
          <span className="cc-today-progress__label">No tasks for today</span>
        </div>
      )}

      {briefing && (
        <div className="cc-briefing-card">
          <div className="cc-briefing-card__header">
            <span className="cc-briefing-card__icon">{'\uD83D\uDCCB'}</span>
            <span className="cc-briefing-card__title">Daily Briefing</span>
          </div>
          <div className="cc-briefing-card__content">{briefing}</div>
        </div>
      )}
      {briefingLoading && !briefing && <BriefingSkeleton />}

      {isLoading && !hasAnything && <TodayPageSkeleton />}

      {!isLoading && !hasAnything && (
        <EmptyState icon="\u2728" message="All clear! Nothing scheduled for today." />
      )}

      {todayEvents.length > 0 && (
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

      {overdueTasks.length > 0 && (
        <SectionHeader title="Overdue" count={overdueTasks.length} variant="warning">
          {overdueTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onToggle={() => toggleTodoComplete(task.id)}
              onClick={() => navigate(`/tasks/${task.id}`)}
            />
          ))}
        </SectionHeader>
      )}

      {todayTasks.length > 0 && (
        <SectionHeader title="Today's Tasks" count={todayTasks.length}>
          {todayTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onToggle={() => toggleTodoComplete(task.id)}
              onClick={() => navigate(`/tasks/${task.id}`)}
            />
          ))}
        </SectionHeader>
      )}

      {inboxCount > 0 && (
        <div className="cc-inbox-banner" onClick={() => navigate('/inbox')}>
          <span style={{ fontSize: 16 }}>{'\uD83D\uDCE5'}</span>
          <span className="cc-inbox-banner__text">
            {inboxCount} item{inboxCount !== 1 ? 's' : ''} in your inbox
          </span>
        </div>
      )}
    </div>
  );
}
