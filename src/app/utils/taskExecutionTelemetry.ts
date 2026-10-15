import type { TaskExecutionTelemetryResponse } from '../types/api';
import { translateUi } from '../i18n';
import { describeTaskStage, getTaskStage } from './taskStage';
type TaskExecutionBadgeTone = 'active' | 'attention' | 'success' | 'error' | 'neutral';
export interface TaskExecutionBadge {
  key: 'run' | 'review' | 'artifact';
  label: string;
  tone: TaskExecutionBadgeTone;
}
export function getTaskExecutionBadges(
  telemetry: TaskExecutionTelemetryResponse | undefined,
): TaskExecutionBadge[] {
  if (!telemetry) return [];
  const badges: TaskExecutionBadge[] = [];
  const runStatus = telemetry.latest_run_status;
  if (runStatus) {
    // The run's step, in the same words as the task list and the run card.
    const stage =
      runStatus === 'completed' || runStatus === 'cancelled'
        ? { stage: 'done' as const, exception: null, cancelled: runStatus === 'cancelled' }
        : getTaskStage({ runStatus });
    badges.push({
      key: 'run',
      label: describeTaskStage(stage),
      tone:
        stage.exception === 'failed'
          ? 'error'
          : stage.exception === 'needs_input' || stage.stage === 'review'
            ? 'attention'
            : stage.stage === 'run'
              ? 'active'
              : stage.cancelled
                ? 'neutral'
                : 'success',
    });
  }
  if (
    telemetry.pending_review_count > 0 &&
    (telemetry.latest_run_status !== 'waiting_review' || telemetry.pending_review_count > 1)
  ) {
    badges.push({
      key: 'review',
      label:
        telemetry.pending_review_count === 1
          ? translateUi('Review')
          : translateUi('{{count}} reviews', { count: telemetry.pending_review_count }),
      tone: 'attention',
    });
  }
  if (telemetry.artifact_count > 0) {
    badges.push({
      key: 'artifact',
      label:
        telemetry.artifact_count === 1
          ? translateUi('1 file')
          : translateUi('{{count}} files', { count: telemetry.artifact_count }),
      tone: 'neutral',
    });
  }
  return badges;
}
