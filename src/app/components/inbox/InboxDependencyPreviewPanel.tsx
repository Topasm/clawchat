import type { TaskDependencyPreviewResponse, TodoResponse } from '../../types/api';

interface InboxDependencyPreviewPanelProps {
  preview: TaskDependencyPreviewResponse;
  todoById: ReadonlyMap<string, TodoResponse>;
  isCreating: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** The confirm step of a "must wait for" edge, with its graph impact. */
export default function InboxDependencyPreviewPanel({
  preview,
  todoById,
  isCreating,
  onConfirm,
  onCancel,
}: InboxDependencyPreviewPanelProps) {
  return (
    <section
      className="cc-inbox-triage__dependency-preview"
      aria-live="polite"
      aria-label="Dependency impact preview"
    >
      <strong>Confirm dependency</strong>
      <p>
        “{todoById.get(preview.dependent_task_id)?.title ?? 'Task'}” will wait for “
        {todoById.get(preview.prerequisite_task_id)?.title ?? 'prerequisite'}”.
      </p>
      {preview.insights_delta && (
        <p>
          Ready {preview.insights_delta.ready_count >= 0 ? '+' : ''}
          {preview.insights_delta.ready_count} · Blocked{' '}
          {preview.insights_delta.blocked_count >= 0 ? '+' : ''}
          {preview.insights_delta.blocked_count} · Critical path{' '}
          {preview.insights_delta.critical_path_minutes == null
            ? 'unchanged'
            : `${preview.insights_delta.critical_path_minutes >= 0 ? '+' : ''}${preview.insights_delta.critical_path_minutes}m`}
        </p>
      )}
      <small>{preview.affected_task_ids.length} affected tasks</small>
      <div>
        <button
          type="button"
          className="cc-btn cc-btn--primary"
          disabled={isCreating}
          onClick={onConfirm}
        >
          {isCreating ? 'Connecting…' : 'Connect'}
        </button>
        <button
          type="button"
          className="cc-btn cc-btn--ghost"
          disabled={isCreating}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
