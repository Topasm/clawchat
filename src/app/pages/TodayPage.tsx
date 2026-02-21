import { useNavigate } from 'react-router-dom';
import useTodayData from '../hooks/useTodayData';
import { useModuleStore } from '../stores/useModuleStore';
import { formatDate } from '../utils/formatters';
import SectionHeader from '../components/shared/SectionHeader';
import TaskCard from '../components/shared/TaskCard';
import EventCard from '../components/shared/EventCard';
import EmptyState from '../components/shared/EmptyState';

export default function TodayPage() {
  const navigate = useNavigate();
  const { todayTasks, overdueTasks, todayEvents, inboxCount, greeting, todayDate, isLoading } = useTodayData();
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

      {isLoading && !hasAnything && (
        <div className="cc-empty__message" style={{ padding: 40, textAlign: 'center' }}>Loading...</div>
      )}

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
