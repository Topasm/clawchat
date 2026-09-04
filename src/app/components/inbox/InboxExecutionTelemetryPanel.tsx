import type { TaskExecutionTelemetryResponse } from '../../types/api';
import { getTaskExecutionBadges } from '../../utils/taskExecutionTelemetry';
import { translateUi } from '../../i18n';

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round((seconds / 3600) * 10) / 10}h`;
}
interface InboxExecutionTelemetryPanelProps {
  telemetry: TaskExecutionTelemetryResponse;
  projectId?: string | null;
  onNavigate: (path: string) => void;
}
/** Agent run and artifact activity for the inspected task. */
export default function InboxExecutionTelemetryPanel({
  telemetry,
  projectId,
  onNavigate,
}: InboxExecutionTelemetryPanelProps) {
  return (
    <section
      className="cc-inbox-triage__execution-telemetry"
      aria-label={translateUi('Task execution activity')}
    >
      <div className="cc-inbox-triage__execution-heading">
        <strong>{translateUi('Execution activity')}</strong>
        <div className="cc-inbox-tree__telemetry">
          {getTaskExecutionBadges(telemetry).map((badge) => (
            <span key={badge.key} className="cc-inbox-tree__telemetry-badge" data-tone={badge.tone}>
              {badge.label}
            </span>
          ))}
        </div>
      </div>
      {telemetry.latest_run_progress_message && <p>{telemetry.latest_run_progress_message}</p>}
      <div className="cc-inbox-triage__collaboration-metrics">
        <small>
          {translateUi('Waiting on people: ')}
          {formatDuration(telemetry.human_wait_seconds)}
        </small>
        <small>
          {translateUi('Questions: ')}
          {telemetry.question_count}
        </small>
        {telemetry.average_resume_seconds !== null && (
          <small>
            {translateUi('Average time to resume: ')}
            {formatDuration(telemetry.average_resume_seconds)}
          </small>
        )}
      </div>
      {telemetry.latest_artifact_title && (
        <small>
          {translateUi('Latest artifact: ')}
          {telemetry.latest_artifact_title}
        </small>
      )}
      <div className="cc-inbox-triage__execution-actions">
        {telemetry.latest_run_id && (
          <button
            type="button"
            className="cc-btn cc-btn--ghost"
            onClick={() => onNavigate(`/runs?run_id=${telemetry.latest_run_id}`)}
          >
            {translateUi('\n            Open run\n          ')}
          </button>
        )}
        {telemetry.pending_review_count > 0 && (
          <button
            type="button"
            className="cc-btn cc-btn--ghost"
            onClick={() => onNavigate(`/review${projectId ? `?project_id=${projectId}` : ''}`)}
          >
            {translateUi('\n            Review\n          ')}
          </button>
        )}
        {telemetry.artifact_count > 0 && projectId && (
          <button
            type="button"
            className="cc-btn cc-btn--ghost"
            onClick={() => onNavigate(`/projects/${projectId}?section=artifacts`)}
          >
            {translateUi('\n            Artifacts\n          ')}
          </button>
        )}
      </div>
    </section>
  );
}
