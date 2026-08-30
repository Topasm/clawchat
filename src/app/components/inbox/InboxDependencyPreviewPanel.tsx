import type { TaskDependencyPreviewResponse, TodoResponse } from '../../types/api';
import { translateUi } from '../../i18n';
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
      aria-label={translateUi('Dependency impact preview')}
    >
      <strong>{translateUi('Confirm dependency')}</strong>
      <p>
        “{todoById.get(preview.dependent_task_id)?.title ?? translateUi('Task')}
        {translateUi('\u201D will wait for \u201C\n        ')}
        {todoById.get(preview.prerequisite_task_id)?.title ?? translateUi('prerequisite')}”.
      </p>
      {preview.insights_delta && (
        <p>
          {translateUi('\n          Ready ')}
          {preview.insights_delta.ready_count >= 0 ? '+' : ''}
          {preview.insights_delta.ready_count}
          {translateUi(' \u00B7 Blocked')} {preview.insights_delta.blocked_count >= 0 ? '+' : ''}
          {preview.insights_delta.blocked_count}
          {translateUi(' \u00B7 Critical path')}{' '}
          {preview.insights_delta.critical_path_minutes == null
            ? translateUi('unchanged')
            : `${preview.insights_delta.critical_path_minutes >= 0 ? '+' : ''}${preview.insights_delta.critical_path_minutes}m`}
        </p>
      )}
      <small>
        {preview.affected_task_ids.length}
        {translateUi(' affected tasks')}
      </small>
      <div>
        <button
          type="button"
          className="cc-btn cc-btn--primary"
          disabled={isCreating}
          onClick={onConfirm}
        >
          {isCreating ? translateUi('Connecting\u2026') : translateUi('Connect')}
        </button>
        <button
          type="button"
          className="cc-btn cc-btn--ghost"
          disabled={isCreating}
          onClick={onCancel}
        >
          {translateUi('\n          Cancel\n        ')}
        </button>
      </div>
    </section>
  );
}
