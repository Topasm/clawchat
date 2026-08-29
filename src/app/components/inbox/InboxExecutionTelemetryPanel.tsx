import type { TaskExecutionTelemetryResponse } from '../../types/api';
import { getTaskExecutionBadges } from '../../utils/taskExecutionTelemetry';

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
    <section className="cc-inbox-triage__execution-telemetry" aria-label="Task execution activity">
      <div className="cc-inbox-triage__execution-heading">
        <strong>Execution activity</strong>
        <div className="cc-inbox-tree__telemetry">
          {getTaskExecutionBadges(telemetry).map((badge) => (
            <span key={badge.key} className="cc-inbox-tree__telemetry-badge" data-tone={badge.tone}>
              {badge.label}
            </span>
          ))}
        </div>
      </div>
      {telemetry.latest_run_progress_message && <p>{telemetry.latest_run_progress_message}</p>}
      {telemetry.latest_artifact_title && (
        <small>Latest artifact: {telemetry.latest_artifact_title}</small>
      )}
      <div className="cc-inbox-triage__execution-actions">
        {telemetry.latest_run_id && (
          <button
            type="button"
            className="cc-btn cc-btn--ghost"
            onClick={() => onNavigate(`/runs?run_id=${telemetry.latest_run_id}`)}
          >
            Open run
          </button>
        )}
        {telemetry.pending_review_count > 0 && (
          <button
            type="button"
            className="cc-btn cc-btn--ghost"
            onClick={() => onNavigate(`/review${projectId ? `?project_id=${projectId}` : ''}`)}
          >
            Review
          </button>
        )}
        {telemetry.artifact_count > 0 && projectId && (
          <button
            type="button"
            className="cc-btn cc-btn--ghost"
            onClick={() => onNavigate(`/projects/${projectId}?section=artifacts`)}
          >
            Artifacts
          </button>
        )}
      </div>
    </section>
  );
}
