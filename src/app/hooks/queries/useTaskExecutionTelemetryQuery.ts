import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import apiClient from '../../services/apiClient';
import { useAuthStore } from '../../stores/useAuthStore';
import {
  TaskExecutionTelemetryResponseSchema,
  type TaskExecutionTelemetryResponse,
} from '../../types/schemas';
import { queryKeys } from './queryKeys';

const EXECUTING_STATUSES = new Set(['queued', 'starting', 'running']);

export function useTaskExecutionTelemetryQuery(projectId?: string | null) {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  return useQuery({
    queryKey: [...queryKeys.taskExecutionTelemetry, projectId ?? 'all'],
    queryFn: async () => {
      const response = await apiClient.get('/todos/execution-telemetry', {
        params: projectId ? { project_id: projectId } : undefined,
      });
      return z.array(TaskExecutionTelemetryResponseSchema).parse(response.data);
    },
    enabled: !!serverUrl,
    refetchInterval: (query) => {
      const telemetry = query.state.data as TaskExecutionTelemetryResponse[] | undefined;
      return telemetry?.some(
        (item) => item.latest_run_status != null && EXECUTING_STATUSES.has(item.latest_run_status),
      )
        ? 3_000
        : false;
    },
  });
}
