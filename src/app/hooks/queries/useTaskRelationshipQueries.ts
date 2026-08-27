import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '../../services/apiClient';
import { useAuthStore } from '../../stores/useAuthStore';
import {
  TaskDependencyCommandResponseSchema,
  TaskDependencyPreviewResponseSchema,
  TaskRelationshipListResponseSchema,
  TaskRelationshipResponseSchema,
} from '../../types/schemas';
import type {
  TaskDependencyCommandRequest,
  TaskDependencyCommandResponse,
  TaskDependencyPreviewResponse,
  TaskRelationshipCreate,
  TaskRelationshipResponse,
} from '../../types/api';
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
    mutationFn: async (relationship: TaskRelationshipCreate): Promise<TaskRelationshipResponse> => {
      const response = await apiClient.post('/task-relationships', relationship);
      return TaskRelationshipResponseSchema.parse(response.data);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.taskRelationships });
      queryClient.invalidateQueries({ queryKey: queryKeys.taskGraphInsights });
      queryClient.invalidateQueries({ queryKey: queryKeys.todos });
      queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    },
  });
}

export function usePreviewTaskDependency() {
  return useMutation({
    mutationFn: async (
      command: TaskDependencyCommandRequest,
    ): Promise<TaskDependencyPreviewResponse> => {
      const response = await apiClient.post(
        '/task-relationships/commands/dependency/preview',
        command,
      );
      return TaskDependencyPreviewResponseSchema.parse(response.data);
    },
  });
}

export function useCreateTaskDependency() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      command: TaskDependencyCommandRequest,
    ): Promise<TaskDependencyCommandResponse> => {
      const response = await apiClient.post('/task-relationships/commands/dependency', command);
      return TaskDependencyCommandResponseSchema.parse(response.data);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.taskRelationships });
      queryClient.invalidateQueries({ queryKey: queryKeys.taskGraphInsights });
      queryClient.invalidateQueries({ queryKey: queryKeys.todos });
      queryClient.invalidateQueries({ queryKey: queryKeys.projects });
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
      queryClient.invalidateQueries({ queryKey: queryKeys.taskGraphInsights });
      queryClient.invalidateQueries({ queryKey: queryKeys.todos });
      queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    },
  });
}
