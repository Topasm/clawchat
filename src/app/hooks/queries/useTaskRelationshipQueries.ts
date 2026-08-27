import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '../../services/apiClient';
import { useAuthStore } from '../../stores/useAuthStore';
import {
  TaskRelationshipListResponseSchema,
  TaskRelationshipResponseSchema,
} from '../../types/schemas';
import type { TaskRelationshipCreate, TaskRelationshipResponse } from '../../types/api';
import { queryKeys } from './queryKeys';

export function useTaskRelationshipsQuery() {
  const serverUrl = useAuthStore((state) => state.serverUrl);

  return useQuery({
    queryKey: queryKeys.taskRelationships,
    queryFn: async () => {
      const response = await apiClient.get('/task-relationships', { params: { limit: 10_000 } });
      return TaskRelationshipListResponseSchema.parse(response.data);
    },
    enabled: Boolean(serverUrl),
  });
}

export function useCreateTaskRelationship() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      relationship: TaskRelationshipCreate,
    ): Promise<TaskRelationshipResponse | undefined> => {
      const response = await apiClient.post('/task-relationships', relationship);
      const parsed = TaskRelationshipResponseSchema.safeParse(response.data);
      return parsed.success ? parsed.data : undefined;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.taskRelationships });
    },
  });
}

export function useDeleteTaskRelationship() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (relationshipId: string) => {
      await apiClient.delete(`/task-relationships/${relationshipId}`);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.taskRelationships });
    },
  });
}
