import type { TaskExecutionTelemetryResponse } from '../types/api';
import { translateUi } from '../i18n';
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
  switch (telemetry.latest_run_status) {
    case 'queued':
      badges.push({ key: 'run', label: translateUi('Agent queued'), tone: 'active' });
      break;
    case 'starting':
      badges.push({ key: 'run', label: translateUi('Agent starting'), tone: 'active' });
      break;
    case 'running':
      badges.push({
        key: 'run',
        label: `Agent ${telemetry.latest_run_progress ?? 0}%`,
        tone: 'active',
      });
      break;
    case 'waiting_input':
      badges.push({ key: 'run', label: translateUi('Needs input'), tone: 'attention' });
      break;
    case 'waiting_review':
      badges.push({ key: 'run', label: translateUi('Waiting review'), tone: 'attention' });
      break;
    case 'completed':
      badges.push({ key: 'run', label: translateUi('Agent done'), tone: 'success' });
      break;
    case 'failed':
      badges.push({ key: 'run', label: translateUi('Run failed'), tone: 'error' });
      break;
    case 'cancelled':
      badges.push({ key: 'run', label: translateUi('Run cancelled'), tone: 'neutral' });
      break;
  }
  if (
    telemetry.pending_review_count > 0 &&
    (telemetry.latest_run_status !== 'waiting_review' || telemetry.pending_review_count > 1)
  ) {
    badges.push({
      key: 'review',
      label:
        telemetry.pending_review_count === 1
          ? 'Waiting review'
          : `${telemetry.pending_review_count} reviews`,
      tone: 'attention',
    });
  }
  if (telemetry.artifact_count > 0) {
    badges.push({
      key: 'artifact',
      label: `${telemetry.artifact_count} ${telemetry.artifact_count === 1 ? 'artifact' : 'artifacts'}`,
      tone: 'neutral',
    });
  }
  return badges;
}
