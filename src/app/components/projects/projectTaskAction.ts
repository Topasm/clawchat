import type {
  TaskExecutionTelemetryResponse,
  TaskGraphInsightNode,
  TodoResponse,
} from '../../types/api';

export function projectTaskAction(
  task: TodoResponse,
  insight: TaskGraphInsightNode | undefined,
  telemetry: TaskExecutionTelemetryResponse | undefined,
  telemetryAvailable: boolean,
): { kind: 'run' | 'thread' | 'details'; label: string; runId?: string } {
  const status = telemetry?.latest_run_status;
  if (
    status &&
    ['queued', 'starting', 'running', 'waiting_input', 'waiting_review'].includes(status)
  ) {
    if (!telemetry?.latest_run_id) return { kind: 'details', label: 'Details' };
    return {
      kind: 'thread',
      runId: telemetry.latest_run_id,
      label:
        status === 'waiting_review'
          ? 'Review result'
          : status === 'waiting_input'
            ? 'Needs input'
            : 'Open run',
    };
  }
  if (
    telemetryAvailable &&
    task.status === 'pending' &&
    insight?.is_ready &&
    !insight.is_container
  ) {
    return { kind: 'run', label: 'Run agent' };
  }
  return { kind: 'details', label: 'Details' };
}
