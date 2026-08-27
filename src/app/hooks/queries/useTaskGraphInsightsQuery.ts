import { useQuery } from '@tanstack/react-query';
import apiClient from '../../services/apiClient';
import { useAuthStore } from '../../stores/useAuthStore';
import type { TaskGraphInsightsResponse } from '../../types/api';
import { TaskGraphInsightsResponseSchema } from '../../types/schemas';
import { queryKeys } from './queryKeys';

export function useTaskGraphInsightsQuery(rootTaskId?: string | null, enabled = true) {
  const serverUrl = useAuthStore((state) => state.serverUrl);

  return useQuery({
    queryKey: queryKeys.taskGraphInsightScope(rootTaskId),
    queryFn: async (): Promise<TaskGraphInsightsResponse> => {
      const response = await apiClient.get('/todos/graph/insights', {
        params: {
          limit: 2000,
          ...(rootTaskId ? { root_task_id: rootTaskId } : {}),
        },
      });
      return TaskGraphInsightsResponseSchema.parse(response.data);
    },
    enabled: Boolean(serverUrl) && enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}
