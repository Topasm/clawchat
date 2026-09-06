import { describe, expect, it } from 'vitest';
import type {
  TaskExecutionTelemetryResponse,
  TaskGraphInsightNode,
  TodoResponse,
} from '../../../types/api';
import { projectTaskAction } from '../projectTaskAction';

const task = { status: 'pending' } as TodoResponse;
const ready = { is_ready: true, is_container: false } as TaskGraphInsightNode;

describe('projectTaskAction', () => {
  it.each(['queued', 'starting', 'running', 'waiting_input', 'waiting_review'] as const)(
    'opens an existing %s run instead of using stale Ready state',
    (status) => {
      const result = projectTaskAction(
        task,
        ready,
        { latest_run_id: 'run', latest_run_status: status } as TaskExecutionTelemetryResponse,
        true,
      );
      expect(result.kind).toBe('thread');
      expect(result.runId).toBe('run');
      if (status === 'waiting_review') expect(result.label).toBe('Review result');
    },
  );
  it('only offers execution when readiness and telemetry are known', () => {
    expect(projectTaskAction(task, ready, undefined, true).kind).toBe('run');
    expect(projectTaskAction(task, ready, undefined, false).kind).toBe('details');
    expect(projectTaskAction(task, undefined, undefined, true).kind).toBe('details');
    expect(projectTaskAction(task, { ...ready, is_container: true }, undefined, true).kind).toBe(
      'details',
    );
  });
  it.each(['completed', 'cancelled', 'in_progress'] as const)(
    'opens details for %s work without an active run',
    (status) => {
      expect(projectTaskAction({ ...task, status }, ready, undefined, true).kind).toBe('details');
    },
  );
  it('does not restart active work whose run id is missing', () => {
    expect(
      projectTaskAction(
        task,
        ready,
        {
          latest_run_id: null,
          latest_run_status: 'waiting_input',
        } as TaskExecutionTelemetryResponse,
        true,
      ).kind,
    ).toBe('details');
  });
});
