import type { KeyboardEvent } from 'react';
import TaskCard from '../shared/TaskCard';
import type { TodoResponse } from '../../types/api';
import {
  INBOX_DEPENDENCY_DRAG_TYPE,
  INBOX_TASK_BATCH_DRAG_TYPE,
  INBOX_TASK_DRAG_TYPE,
} from './inboxDragTransfer';
import { translateUi } from '../../i18n';
interface InboxCapturedCardProps {
  task: TodoResponse;
  isSelected: boolean;
  isBatchSelected: boolean;
  batchTaskIds: string[];
  subTaskCount: number;
  draggable: boolean;
  dependencyDraggable: boolean;
  onSelect: (taskId: string) => void;
  onToggleBatch: (taskId: string) => void;
  onToggleComplete: (taskId: string) => void;
  onDelete: (taskId: string) => void;
  onOrganize: (taskId: string) => void;
}
/**
 * One captured task in the triage queue. It is the drag source for both a placement
 * (single or batch) and a dependency connection. The whole row selects the task;
 * the side cluster carries the batch checkbox, the prerequisite handle, and Organize.
 */
export default function InboxCapturedCard({
  task,
  isSelected,
  isBatchSelected,
  batchTaskIds,
  subTaskCount,
  draggable,
  dependencyDraggable,
  onSelect,
  onToggleBatch,
  onToggleComplete,
  onDelete,
  onOrganize,
}: InboxCapturedCardProps) {
  const className = [
    'cc-inbox-card',
    'cc-inbox-card--captured',
    isSelected ? 'cc-inbox-card--selected' : '',
    isBatchSelected ? 'cc-inbox-card--batch-selected' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const selectFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(task.id);
    }
  };
  return (
    <div
      className={className}
      tabIndex={0}
      aria-label={translateUi('Select {{title}} for placement', { title: task.title })}
      draggable={draggable}
      onDragStart={(event) => {
        if (isBatchSelected && batchTaskIds.length > 1) {
          event.dataTransfer.setData(INBOX_TASK_BATCH_DRAG_TYPE, JSON.stringify(batchTaskIds));
        } else {
          event.dataTransfer.setData(INBOX_TASK_DRAG_TYPE, task.id);
        }
        event.dataTransfer.effectAllowed = 'move';
        onSelect(task.id);
      }}
      onClick={() => onSelect(task.id)}
      onKeyDown={selectFromKeyboard}
    >
      <TaskCard
        task={task}
        onToggle={() => onToggleComplete(task.id)}
        onClick={() => onSelect(task.id)}
        onDelete={() => onDelete(task.id)}
        subTaskCount={subTaskCount}
      />
      <div className="cc-inbox-card__side">
        <label
          className="cc-inbox-batch-check"
          title={translateUi('Move together with other selected tasks')}
        >
          <input
            type="checkbox"
            checked={isBatchSelected}
            aria-label={translateUi('Select {{title}} for batch placement', { title: task.title })}
            onClick={(event) => event.stopPropagation()}
            onChange={() => onToggleBatch(task.id)}
          />
        </label>
        <button
          className="cc-inbox-dependency-handle"
          type="button"
          draggable={dependencyDraggable}
          aria-label={translateUi('Drag {{title}} to a task that must finish first', {
            title: task.title,
          })}
          title={translateUi('Connect a prerequisite')}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onDragStart={(event) => {
            event.stopPropagation();
            event.dataTransfer.setData(INBOX_DEPENDENCY_DRAG_TYPE, task.id);
            event.dataTransfer.effectAllowed = 'link';
            onSelect(task.id);
          }}
        >
          <span aria-hidden="true">↝</span>
        </button>
        {/* The one action a captured card always offers. */}
        <button
          className="cc-btn cc-btn--compact cc-btn--secondary cc-inbox-card__organize"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOrganize(task.id);
          }}
        >
          {translateUi('Organize')}
        </button>
      </div>
    </div>
  );
}
