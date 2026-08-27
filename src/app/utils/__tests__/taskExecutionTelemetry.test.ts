import { describe, expect, it } from 'vitest';

import type { TaskExecutionTelemetryResponse } from '../../types/api';
import { getTaskExecutionBadges } from '../taskExecutionTelemetry';

function telemetry(
  overrides: Partial<TaskExecutionTelemetryResponse> = {},
): TaskExecutionTelemetryResponse {
  return {
    task_id: 'task-1',
    latest_run_id: null,
    latest_run_status: null,
    latest_run_progress: null,
    latest_run_provider: null,
    latest_run_progress_message: null,
    latest_run_updated_at: null,
    pending_review_count: 0,
    artifact_count: 0,
    latest_artifact_id: null,
    latest_artifact_title: null,
    latest_artifact_type: null,
    latest_artifact_updated_at: null,
    ...overrides,
  };
}

describe('getTaskExecutionBadges', () => {
  it('shows live progress and attached artifacts', () => {
    expect(
      getTaskExecutionBadges(
        telemetry({ latest_run_status: 'running', latest_run_progress: 42, artifact_count: 2 }),
      ),
    ).toEqual([
      { key: 'run', label: 'Agent 42%', tone: 'active' },
      { key: 'artifact', label: '2 artifacts', tone: 'neutral' },
    ]);
  });

  it('does not duplicate a single run review badge', () => {
    expect(
      getTaskExecutionBadges(
        telemetry({ latest_run_status: 'waiting_review', pending_review_count: 1 }),
      ),
    ).toEqual([{ key: 'run', label: 'Waiting review', tone: 'attention' }]);
  });

  it('keeps additional pending reviews visible', () => {
    expect(
      getTaskExecutionBadges(
        telemetry({ latest_run_status: 'waiting_review', pending_review_count: 2 }),
      ),
    ).toEqual([
      { key: 'run', label: 'Waiting review', tone: 'attention' },
      { key: 'review', label: '2 reviews', tone: 'attention' },
    ]);
  });
});
