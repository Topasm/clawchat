import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '../../../stores/useAuthStore';
import type { TaskExecutionTelemetryResponse } from '../../../types/api';
import { useTaskExecutionTelemetryQuery } from '../useTaskExecutionTelemetryQuery';

const apiMocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('../../../services/apiClient', () => ({ default: apiMocks }));

const item: TaskExecutionTelemetryResponse = {
  task_id: 'task-1',
  latest_run_id: 'run-1',
  latest_run_status: 'running',
  latest_run_progress: 35,
  latest_run_provider: 'openclaw',
  latest_run_progress_message: 'Working',
  latest_run_updated_at: '2026-08-28T00:00:00Z',
  human_wait_seconds: 0,
  question_count: 0,
  average_resume_seconds: null,
  pending_review_count: 0,
  artifact_count: 1,
  latest_artifact_id: 'artifact-1',
  latest_artifact_title: 'Draft',
  latest_artifact_type: 'report',
  latest_artifact_updated_at: '2026-08-28T00:00:00Z',
};

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('useTaskExecutionTelemetryQuery', () => {
  beforeEach(() => {
    apiMocks.get.mockReset();
    useAuthStore.setState({ serverUrl: 'https://host.example' });
  });

  it('loads a project-scoped execution projection', async () => {
    apiMocks.get.mockResolvedValue({ data: [item] });
    const { result } = renderHook(() => useTaskExecutionTelemetryQuery('project-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiMocks.get).toHaveBeenCalledWith('/todos/execution-telemetry', {
      params: { project_id: 'project-1' },
    });
    expect(result.current.data).toEqual([item]);
  });

  it('fails closed when an execution status drifts from the API contract', async () => {
    apiMocks.get.mockResolvedValue({
      data: [{ ...item, latest_run_status: 'almost_done' }],
    });
    const { result } = renderHook(() => useTaskExecutionTelemetryQuery(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
