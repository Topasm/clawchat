import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '../../services/apiClient';
import { useAuthStore } from '../../stores/useAuthStore';
import { useToastStore } from '../../stores/useToastStore';
import { DelegateResponseSchema, SkillsResponseSchema } from '../../types/schemas';
import { invalidateTaskDerivedQueries } from './invalidateTaskDerivedQueries';
import { queryKeys } from './queryKeys';

export interface StartReadyTaskExecutionVariables {
  todoId: string;
  skillId: string;
  executionProvider: string;
  model?: string | null;
}

export function useSkillsQuery(enabled = true) {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  return useQuery({
    queryKey: queryKeys.skills,
    queryFn: async () => {
      const response = await apiClient.get('/todos/skills/list');
      return SkillsResponseSchema.parse(response.data);
    },
    enabled: !!serverUrl && enabled,
    staleTime: 5 * 60_000,
  });
}

function executionErrorMessage(error: unknown): string {
  const response = error as {
    response?: { data?: { error?: { code?: string; message?: string } } };
  };
  const code = response.response?.data?.error?.code;
  if (code === 'TASK_NOT_READY') return 'This task is no longer Ready. Refresh its blockers.';
  if (code === 'TASK_EXECUTION_ACTIVE') return 'This task already has an active agent run.';
  if (code === 'TASK_EXECUTION_CONFLICT') return 'The task changed before execution started.';
  return response.response?.data?.error?.message ?? 'Could not start the agent run.';
}

export function useStartReadyTaskExecution() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      todoId,
      skillId,
      executionProvider,
      model,
    }: StartReadyTaskExecutionVariables) => {
      const response = await apiClient.post(`/todos/${todoId}/delegate`, {
        skill_id: skillId,
        execution_provider: executionProvider,
        model: model || null,
        require_ready: true,
        approved: true,
      });
      return DelegateResponseSchema.parse(response.data);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.todos }),
        queryClient.invalidateQueries({ queryKey: queryKeys.runs }),
        queryClient.invalidateQueries({ queryKey: queryKeys.taskExecutionTelemetry }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
        invalidateTaskDerivedQueries(queryClient),
      ]);
      useToastStore.getState().addToast('success', 'Agent run started');
    },
    onError: (error) => {
      useToastStore.getState().addToast('error', executionErrorMessage(error));
    },
  });
}
