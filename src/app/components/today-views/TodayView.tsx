import { useNavigate } from 'react-router-dom';
import { useModuleStore } from '../../stores/useModuleStore';
import usePlatform from '../../hooks/usePlatform';
import { formatDate } from '../../utils/formatters';
import SectionHeader from '../shared/SectionHeader';
import TaskCard from '../shared/TaskCard';
import EventCard from '../shared/EventCard';
import EmptyState from '../shared/EmptyState';
import { SparkleIcon, ClipboardIcon, InboxTrayIcon, FlameIcon } from '../shared/Icons';
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
  const { isMobile } = usePlatform();

  const totalTasks = todayTasks.length + overdueTasks.length;
  const hasAnything = totalTasks > 0 || todayEvents.length > 0;
  const visibleOverdueTasks = isMobile ? overdueTasks.slice(0, 3) : overdueTasks;
  const visibleTodayTasks = isMobile ? todayTasks.slice(0, 4) : todayTasks;

  return (
    <div>
      <div className="cc-page-header">
        <div className="cc-page-header__title">{greeting || 'Hello'}</div>
        <div className="cc-page-header__subtitle">
          {todayDate ? formatDate(todayDate) : ''}
          {!isMobile && totalTasks > 0 && ` \u00B7 ${totalTasks} task${totalTasks !== 1 ? 's' : ''} for today`}
        </div>
      </div>

      <QuickCaptureModal
        isOpen={showCapture}
        onClose={onCloseCapture}
        placeholder={capturePlaceholder}
      />

      {isMobile && (
        <div className="cc-today-home-actions">
          <button type="button" className="cc-btn cc-btn--primary" onClick={() => navigate('/chats')}>
            Open Chat
          </button>
          <button type="button" className="cc-btn cc-btn--secondary" onClick={() => navigate('/inbox')}>
            Inbox
          </button>
        </div>
      )}

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

      {briefing && !isMobile && (
        <div className="cc-briefing-card">
          <div className="cc-briefing-card__header">
            <span className="cc-briefing-card__icon"><ClipboardIcon size={16} /></span>
            <span className="cc-briefing-card__title">Daily Briefing</span>
          </div>
          <div className="cc-briefing-card__content">{briefing}</div>
        </div>
      )}
      {briefingLoading && !briefing && <BriefingSkeleton />}

      {isLoading && !hasAnything && <TodayPageSkeleton />}

      {!isLoading && !hasAnything && (
        <EmptyState icon={<SparkleIcon size={20} />} message={isMobile ? 'Nothing urgent right now.' : 'All clear! Nothing scheduled for today.'} />
      )}

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

      {inboxCount > 0 && !isMobile && (
        <div className="cc-inbox-banner" onClick={() => navigate('/inbox')}>
          <InboxTrayIcon size={16} />
          <span className="cc-inbox-banner__text">
            {inboxCount} item{inboxCount !== 1 ? 's' : ''} in your inbox
          </span>
        </div>
      )}
    </div>
  );
}
