import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import apiClient from '../../services/apiClient';
import { useAuthStore } from '../../stores/useAuthStore';
import { useToastStore } from '../../stores/useToastStore';
import {
  AgentRunEventResponseSchema,
  AgentRunRecoveryResponseSchema,
  AgentRunResponseSchema,
} from '../../types/schemas';
import type { AgentRunResponse } from '../../types/api';
import { queryKeys } from './queryKeys';
import { translateUi } from '../../i18n';
const ACTIVE = new Set(['queued', 'starting', 'running']);
export function useAgentRunsQuery(projectId?: string | null) {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  return useQuery({
    queryKey: queryKeys.runList(projectId),
    queryFn: async () => {
      const response = await apiClient.get('/runs', {
        params: projectId ? { project_id: projectId } : undefined,
      });
      return z.array(AgentRunResponseSchema).parse(response.data);
    },
    enabled: !!serverUrl,
    refetchInterval: (query) => {
      const runs = query.state.data as AgentRunResponse[] | undefined;
      return runs?.some((run) => ACTIVE.has(run.status)) ? 3000 : false;
    },
  });
}
/**
 * Runs stopped on a question or a permission, i.e. the agent is waiting on you.
 *
 * No polling: the server pushes `module_data_changed("runs")` on every
 * transition, so this only refetches when something actually moved. Mounted
 * app-wide (nav badge), which is why it must stay cheap.
 */
export function useRunsAwaitingInputQuery() {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  return useQuery({
    queryKey: queryKeys.runsByStatus('waiting_input'),
    queryFn: async () => {
      const response = await apiClient.get('/runs', {
        params: { status: 'waiting_input', limit: 100 },
      });
      return z.array(AgentRunResponseSchema).parse(response.data);
    },
    enabled: !!serverUrl,
  });
}
export function useAgentRunEventsQuery(runId: string | null) {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  return useQuery({
    queryKey: queryKeys.runEvents(runId ?? ''),
    queryFn: async () => {
      const response = await apiClient.get(`/runs/${runId}/events`);
      return z.array(AgentRunEventResponseSchema).parse(response.data);
    },
    enabled: !!serverUrl && !!runId,
  });
}
function invalidateRuns(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: queryKeys.runs });
  queryClient.invalidateQueries({ queryKey: queryKeys.projects });
  queryClient.invalidateQueries({ queryKey: queryKeys.reviews });
  queryClient.invalidateQueries({ queryKey: queryKeys.taskExecutionTelemetry });
  queryClient.invalidateQueries({ queryKey: queryKeys.todos });
  queryClient.invalidateQueries({ queryKey: queryKeys.taskGraphInsights });
}
export function useCancelAgentRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) => {
      const response = await apiClient.post(`/runs/${runId}/cancel`);
      return AgentRunResponseSchema.parse(response.data);
    },
    onSuccess: () => {
      invalidateRuns(queryClient);
      useToastStore.getState().addToast('success', translateUi('Agent run cancelled'));
    },
    onError: () =>
      useToastStore.getState().addToast('error', translateUi('Could not cancel agent run')),
  });
}
export function useRetryAgentRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ runId, followUp }: { runId: string; followUp?: string }) => {
      const response = await apiClient.post(`/runs/${runId}/retry`, {
        follow_up_instruction: followUp?.trim() || null,
      });
      return AgentRunResponseSchema.parse(response.data);
    },
    onSuccess: () => {
      invalidateRuns(queryClient);
      useToastStore.getState().addToast('success', translateUi('New agent attempt started'));
    },
    onError: () =>
      useToastStore.getState().addToast('error', translateUi('Could not retry agent run')),
  });
}
export function useReturnAgentRunToReady() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) => {
      const response = await apiClient.post(`/runs/${runId}/return-to-ready`);
      return AgentRunRecoveryResponseSchema.parse(response.data);
    },
    onSuccess: (result) => {
      invalidateRuns(queryClient);
      useToastStore
        .getState()
        .addToast(
          'success',
          translateUi(
            result.is_ready ? 'Task returned to Ready' : 'Task returned to the queue · Blocked',
          ),
        );
    },
    onError: () =>
      useToastStore
        .getState()
        .addToast('error', translateUi('Could not return task to the execution queue')),
  });
}
export function useResumeAgentRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ runId, followUp }: { runId: string; followUp: string }) => {
      const response = await apiClient.post(`/runs/${runId}/resume`, {
        follow_up_instruction: followUp.trim(),
      });
      return AgentRunResponseSchema.parse(response.data);
    },
    onSuccess: () => {
      invalidateRuns(queryClient);
      useToastStore.getState().addToast('success', translateUi('Agent run resumed'));
    },
    onError: () =>
      useToastStore.getState().addToast('error', translateUi('Could not resume agent run')),
  });
}
