import TaskCard from '../shared/TaskCard';
import type { TodoResponse } from '../../types/api';
import {
  INBOX_DEPENDENCY_DRAG_TYPE,
  INBOX_TASK_BATCH_DRAG_TYPE,
  INBOX_TASK_DRAG_TYPE,
} from './inboxDragTransfer';

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
 * (single or batch) and a dependency connection.
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
  return (
    <div
      className={`cc-inbox-card${isSelected ? ' cc-inbox-card--selected' : ''}${isBatchSelected ? ' cc-inbox-card--batch-selected' : ''}`}
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
    >
      <TaskCard
        task={task}
        onToggle={() => onToggleComplete(task.id)}
        onClick={() => onSelect(task.id)}
        onDelete={() => onDelete(task.id)}
        subTaskCount={subTaskCount}
      />
      <div className="cc-inbox-card__actions">
        <label className="cc-inbox-batch-check">
          <input
            type="checkbox"
            checked={isBatchSelected}
            aria-label={`Select ${task.title} for batch placement`}
            onClick={(event) => event.stopPropagation()}
            onChange={() => onToggleBatch(task.id)}
          />
          Batch
        </label>
        <button
          className="cc-inbox-dependency-handle"
          type="button"
          draggable={dependencyDraggable}
          aria-label={`Drag ${task.title} to a task that must finish first`}
          title="Connect a prerequisite"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onDragStart={(event) => {
            event.stopPropagation();
            event.dataTransfer.setData(INBOX_DEPENDENCY_DRAG_TYPE, task.id);
            event.dataTransfer.effectAllowed = 'link';
            onSelect(task.id);
          }}
        >
          <span aria-hidden="true">↝</span> Prerequisite
        </button>
        <button
          className="cc-btn cc-btn--ghost"
          type="button"
          aria-label={`Select ${task.title} for placement`}
          onClick={() => onSelect(task.id)}
        >
          Select
        </button>
        <button
          className="cc-btn cc-btn--secondary"
          style={{ fontSize: 12 }}
          onClick={() => onOrganize(task.id)}
        >
          Organize
        </button>
      </div>
    </div>
  );
}
