import type { InboxTriagePreviewResponse, ProjectResponse, TodoResponse } from '../../types/api';
import { translateUi } from '../../i18n';
interface InboxTriagePreviewPanelProps {
  preview: InboxTriagePreviewResponse;
  projects: ProjectResponse[];
  todoById: ReadonlyMap<string, TodoResponse>;
  selectedTaskIds: string[];
  isApplying: boolean;
  onToggleSuggestion: (taskId: string) => void;
  onDismiss: () => void;
  onApply: () => void;
}
/** The reviewable AI placement plan: proposed Workstreams, per-task suggestions, apply. */
export default function InboxTriagePreviewPanel({
  preview,
  projects,
  todoById,
  selectedTaskIds,
  isApplying,
  onToggleSuggestion,
  onDismiss,
  onApply,
}: InboxTriagePreviewPanelProps) {
  return (
    <div className="cc-inbox-triage__ai-preview" aria-live="polite">
      <div className="cc-inbox-triage__ai-preview-header">
        <div>
          <strong>{translateUi('AI placement preview')}</strong>
          <span>
            {preview.suggestions.length}
            {translateUi(' suggested\n            ')}
            {preview.proposed_workstreams.length > 0
              ? translateUi(
                  preview.proposed_workstreams.length === 1
                    ? ' · 1 new Workstream'
                    : ' · {{count}} new Workstreams',
                  { count: preview.proposed_workstreams.length },
                )
              : ''}
            {preview.model_provider ? ` · ${preview.model_provider}` : ''}
          </span>
        </div>
        <button type="button" className="cc-btn cc-btn--ghost" onClick={onDismiss}>
          {translateUi('\n          Dismiss\n        ')}
        </button>
      </div>
      {preview.proposed_workstreams.map((workstream) => {
        const project = projects.find((item) => item.id === workstream.project_id);
        const parent = workstream.parent_id ? todoById.get(workstream.parent_id) : null;
        const selectedCount = preview.suggestions.filter(
          (suggestion) =>
            suggestion.proposed_parent_key === workstream.key &&
            selectedTaskIds.includes(suggestion.task_id),
        ).length;
        return (
          <div
            key={workstream.key}
            className="cc-inbox-triage__ai-workstream"
            aria-label={translateUi('Proposed Workstream {{title}}', {
              title: workstream.title,
            })}
          >
            <span>{translateUi('AI proposed Workstream')}</span>
            <strong>{workstream.title}</strong>
            <small>
              {project?.title ?? workstream.project_id}
              {parent ? ` / ${parent.title}` : translateUi(' / Project root')} ·{' '}
              {Math.round(workstream.confidence * 100)}% · {selectedCount}
              {translateUi(' selected task\n              ')}
              {selectedCount === 1 ? '' : 's'}
            </small>
            <small>{workstream.reason}</small>
          </div>
        );
      })}
      {preview.suggestions.map((suggestion) => {
        const project = projects.find((item) => item.id === suggestion.project_id);
        const parent = suggestion.parent_id ? todoById.get(suggestion.parent_id) : null;
        const proposed = suggestion.proposed_parent_key
          ? preview.proposed_workstreams.find(
              (workstream) => workstream.key === suggestion.proposed_parent_key,
            )
          : null;
        return (
          <label key={suggestion.task_id} className="cc-inbox-triage__ai-suggestion">
            <input
              type="checkbox"
              checked={selectedTaskIds.includes(suggestion.task_id)}
              onChange={() => onToggleSuggestion(suggestion.task_id)}
            />
            <span>
              <strong>{todoById.get(suggestion.task_id)?.title ?? suggestion.task_id}</strong>
              <small>
                → {project?.title ?? suggestion.project_id}
                {proposed
                  ? translateUi(' / {{title}} (new)', { title: proposed.title })
                  : parent
                    ? ` / ${parent.title}`
                    : translateUi(' / Project root')}{' '}
                · {Math.round(suggestion.confidence * 100)}%
              </small>
              <small>{suggestion.reason}</small>
            </span>
          </label>
        );
      })}
      {preview.unassigned_task_ids.length > 0 && (
        <p>
          {translateUi('\n          No confident location: ')}
          {preview.unassigned_task_ids.length}
          {translateUi(' task\n          ')}
          {preview.unassigned_task_ids.length === 1 ? '' : 's'}
        </p>
      )}
      <button
        type="button"
        className="cc-btn cc-btn--primary"
        disabled={selectedTaskIds.length === 0 || isApplying}
        onClick={onApply}
      >
        {isApplying
          ? translateUi('Applying\u2026')
          : translateUi('Apply selected ({{count}})', { count: selectedTaskIds.length })}
      </button>
    </div>
  );
}
