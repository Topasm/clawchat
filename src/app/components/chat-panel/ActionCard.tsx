import { useNavigate } from 'react-router-dom';
import { CalendarIcon, MemoIcon } from '../shared/Icons';
import SchedulingSuggestions from './SchedulingSuggestions';
import TaskProgressCard from './TaskProgressCard';

interface ActionCardProps {
  metadata: Record<string, unknown>;
}

function TaskIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 9l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M9 6v4M9 13h.01" strokeLinecap="round" />
      <path d="M8.06 2.7L1.56 14.1a1.1 1.1 0 00.94 1.65h12.98a1.1 1.1 0 00.94-1.65L9.94 2.7a1.1 1.1 0 00-1.88 0z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="var(--cc-success)" strokeWidth="2">
      <circle cx="9" cy="9" r="7" />
      <path d="M6 9l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function ActionCard({ metadata }: ActionCardProps) {
  const navigate = useNavigate();
  const actionType = metadata.action_type as string;

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
            {actionType === 'event_created' ? 'Event Created' : 'Event Updated'}
          </span>
          <span className="cc-action-card__title">{metadata.event_title as string}</span>
          {metadata.event_start_time && (
            <span className="cc-action-card__detail">
              {new Date(metadata.event_start_time as string).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
            </span>
          )}
        </div>
        <button
          type="button"
          className="cc-btn cc-btn--ghost cc-action-card__view-btn"
          onClick={() => navigate(`/events/${metadata.event_id}`)}
        >
          View
        </button>
      </div>
    );
  }

  // Todo actions
  if (actionType === 'todo_created' || actionType === 'todo_completed' || actionType === 'todo_updated') {
    const label = actionType === 'todo_created' ? 'Task Created' : actionType === 'todo_completed' ? 'Task Completed' : 'Task Updated';
    return (
      <div className="cc-action-card">
        <div className="cc-action-card__icon cc-action-card__icon--todo">
          <TaskIcon />
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
          View
        </button>
      </div>
    );
  }

  // Memo actions
  if (actionType === 'memo_created' || actionType === 'memo_updated') {
    return (
      <div className="cc-action-card">
        <div className="cc-action-card__icon cc-action-card__icon--memo">
          <MemoIcon size={14} />
        </div>
        <div className="cc-action-card__content">
          <span className="cc-action-card__label">
            {actionType === 'memo_created' ? 'Memo Saved' : 'Memo Updated'}
          </span>
          <span className="cc-action-card__title">{metadata.memo_title as string}</span>
        </div>
      </div>
    );
  }

  // Scheduling suggestions (Phase 3)
  if (actionType === 'scheduling_suggestions') {
    const suggestions = metadata.suggestions as Array<{ start: string; end: string; reason: string }>;
    return (
      <SchedulingSuggestions
        suggestions={suggestions ?? []}
        title={metadata.title as string}
      />
    );
  }

  // Conflict check results
  if (actionType === 'conflicts_found') {
    const conflicts = metadata.conflicts as Array<{ title: string }>;
    return (
      <div className="cc-action-card cc-action-card--warning">
        <div className="cc-action-card__icon cc-action-card__icon--warning">
          <WarningIcon />
        </div>
        <div className="cc-action-card__content">
          <span className="cc-action-card__label">Scheduling Conflicts</span>
          {conflicts?.map((c, i) => (
            <span key={i} className="cc-action-card__detail">{c.title}</span>
          ))}
        </div>
      </div>
    );
  }

  if (actionType === 'no_conflicts') {
    return (
      <div className="cc-action-card cc-action-card--success">
        <div className="cc-action-card__icon cc-action-card__icon--success">
          <CheckIcon />
        </div>
        <div className="cc-action-card__content">
          <span className="cc-action-card__label">No Conflicts</span>
          <span className="cc-action-card__detail">Your schedule is clear for this time.</span>
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
    const title = (metadata.event_title ?? metadata.todo_title ?? metadata.memo_title) as string;
    return (
      <div className="cc-action-card cc-action-card--warning">
        <div className="cc-action-card__content">
          <span className="cc-action-card__label">{module === 'events' ? 'Event' : module === 'todos' ? 'Task' : 'Memo'} Deleted</span>
          <span className="cc-action-card__title">{title}</span>
        </div>
      </div>
    );
  }

  return null;
}
