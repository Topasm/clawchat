import { useNavigate } from 'react-router-dom';
import { CalendarIcon, CheckCircleIcon, CheckIcon, WarningIcon } from '../shared/Icons';
import SchedulingSuggestions from './SchedulingSuggestions';
import TaskProgressCard from './TaskProgressCard';
import { translateUi } from '../../i18n';
interface ActionCardProps {
  metadata: Record<string, unknown>;
}
export default function ActionCard({ metadata }: ActionCardProps) {
  const navigate = useNavigate();
  const actionType = metadata.action_type as string;
  const eventStartTime =
    typeof metadata.event_start_time === 'string' ? metadata.event_start_time : null;
  if (!actionType) return null;
  // Event actions
  if (actionType === 'event_created' || actionType === 'event_updated') {
    return (
      <div className="cc-action-card">
        <div className="cc-action-card__icon cc-action-card__icon--event">
          <CalendarIcon size={14} />
        </div>
        <div className="cc-action-card__content">
          <span className="cc-action-card__label">
            {actionType === 'event_created'
              ? translateUi('Event Created')
              : translateUi('Event Updated')}
          </span>
          <span className="cc-action-card__title">{metadata.event_title as string}</span>
          {eventStartTime ? (
            <span className="cc-action-card__detail">
              {new Date(eventStartTime).toLocaleString([], {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          className="cc-btn cc-btn--ghost cc-action-card__view-btn"
          onClick={() => navigate(`/events/${metadata.event_id}`)}
        >
          {translateUi('\n          View\n        ')}
        </button>
      </div>
    );
  }
  // Todo actions
  if (
    actionType === 'todo_created' ||
    actionType === 'todo_completed' ||
    actionType === 'todo_updated'
  ) {
    const label =
      actionType === 'todo_created'
        ? 'Task Created'
        : actionType === 'todo_completed'
          ? 'Task Completed'
          : 'Task Updated';
    return (
      <div className="cc-action-card">
        <div className="cc-action-card__icon cc-action-card__icon--todo">
          <CheckIcon size={14} />
        </div>
        <div className="cc-action-card__content">
          <span className="cc-action-card__label">{label}</span>
          <span className="cc-action-card__title">{metadata.todo_title as string}</span>
        </div>
        <button
          type="button"
          className="cc-btn cc-btn--ghost cc-action-card__view-btn"
          onClick={() => navigate(`/tasks/${metadata.todo_id}`)}
        >
          {translateUi('\n          View\n        ')}
        </button>
      </div>
    );
  }
  // Scheduling suggestions (Phase 3)
  if (actionType === 'scheduling_suggestions') {
    const suggestions = metadata.suggestions as Array<{
      start: string;
      end: string;
      reason: string;
    }>;
    return (
      <SchedulingSuggestions suggestions={suggestions ?? []} title={metadata.title as string} />
    );
  }
  // Conflict check results
  if (actionType === 'conflicts_found') {
    const conflicts = metadata.conflicts as Array<{
      title: string;
    }>;
    return (
      <div className="cc-action-card cc-action-card--warning">
        <div className="cc-action-card__icon cc-action-card__icon--warning">
          <WarningIcon size={14} />
        </div>
        <div className="cc-action-card__content">
          <span className="cc-action-card__label">{translateUi('Scheduling Conflicts')}</span>
          {conflicts?.map((c, i) => (
            <span key={i} className="cc-action-card__detail">
              {c.title}
            </span>
          ))}
        </div>
      </div>
    );
  }
  if (actionType === 'no_conflicts') {
    return (
      <div className="cc-action-card cc-action-card--success">
        <div className="cc-action-card__icon cc-action-card__icon--success">
          <CheckCircleIcon size={14} />
        </div>
        <div className="cc-action-card__content">
          <span className="cc-action-card__label">{translateUi('No Conflicts')}</span>
          <span className="cc-action-card__detail">
            {translateUi('Your schedule is clear for this time.')}
          </span>
        </div>
      </div>
    );
  }
  // Task delegated (Phase 4)
  if (actionType === 'task_delegated') {
    return (
      <TaskProgressCard
        taskId={metadata.task_id as string}
        isMultiAgent={metadata.is_multi_agent as boolean}
      />
    );
  }
  // Delete actions
  if (actionType.endsWith('_deleted')) {
    const module = metadata.module as string;
    const title = (metadata.event_title ?? metadata.todo_title) as string;
    return (
      <div className="cc-action-card cc-action-card--warning">
        <div className="cc-action-card__content">
          <span className="cc-action-card__label">
            {module === 'events' ? translateUi('Event') : translateUi('Task')}
            {translateUi(' Deleted')}
          </span>
          <span className="cc-action-card__title">{title}</span>
        </div>
      </div>
    );
  }
  return null;
}
