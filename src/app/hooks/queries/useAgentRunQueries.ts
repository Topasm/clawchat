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
import { isRunExecuting } from '../../utils/taskStage';
import {
  HomeUnreachableError,
  homeUnreachableMessage,
  requireHome,
} from '../../services/homeReachability';
import { translateUi } from '../../i18n';
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
      return runs?.some((run) => isRunExecuting(run.status)) ? 3000 : false;
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
/**
 * Runs that are working right now, for the sidebar line and the palette.
 *
 * No polling either: `run_state_changed` arrives on every transition and
 * invalidates the runs queries, so the line is right without a timer.
 */
export function useActiveRunsQuery() {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  return useQuery({
    queryKey: queryKeys.runsByStatus('active'),
    queryFn: async () => {
      const response = await apiClient.get('/runs', { params: { limit: 100 } });
      return z
        .array(AgentRunResponseSchema)
        .parse(response.data)
        .filter((run) => isRunExecuting(run.status));
    },
    enabled: !!serverUrl,
  });
}
/** A run's event log; [live] rereads it every few seconds while the run works. */
/**
 * A run's event log. With `tail`, only its last `tail` events: a live card
 * polling for the latest steps should not re-download the whole log.
 */
export function useAgentRunEventsQuery(runId: string | null, live = false, tail?: number) {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const logKey = queryKeys.runEvents(runId ?? '');
  return useQuery({
    queryKey: tail ? [...logKey, 'tail', tail] : logKey,
    queryFn: async () => {
      const response = await apiClient.get(`/runs/${runId}/events`, {
        params: tail ? { tail } : undefined,
      });
      return z.array(AgentRunEventResponseSchema).parse(response.data);
    },
    enabled: !!serverUrl && !!runId,
    refetchInterval: live ? 3000 : false,
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
      requireHome();
      const response = await apiClient.post(`/runs/${runId}/retry`, {
        follow_up_instruction: followUp?.trim() || null,
      });
      return AgentRunResponseSchema.parse(response.data);
    },
    onSuccess: () => {
      invalidateRuns(queryClient);
      useToastStore.getState().addToast('success', translateUi('New agent attempt started'));
    },
    onError: (error) =>
      error instanceof HomeUnreachableError
        ? useToastStore.getState().addToast('info', homeUnreachableMessage())
        : useToastStore.getState().addToast('error', translateUi('Could not retry agent run')),
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
      requireHome();
      const response = await apiClient.post(`/runs/${runId}/resume`, {
        follow_up_instruction: followUp.trim(),
      });
      return AgentRunResponseSchema.parse(response.data);
    },
    onSuccess: () => {
      invalidateRuns(queryClient);
      useToastStore.getState().addToast('success', translateUi('Agent run resumed'));
    },
    onError: (error) =>
      error instanceof HomeUnreachableError
        ? useToastStore.getState().addToast('info', homeUnreachableMessage())
        : useToastStore.getState().addToast('error', translateUi('Could not resume agent run')),
  });
}

export function useResolvePaseoPermission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ runId, decision }: { runId: string; decision: 'allow' | 'deny' }) => {
      const response = await apiClient.post(`/runs/${runId}/permission`, { decision });
      return AgentRunResponseSchema.parse(response.data);
    },
    onSuccess: () => {
      invalidateRuns(queryClient);
      useToastStore.getState().addToast('success', translateUi('Permission response sent'));
    },
    onError: () =>
      useToastStore.getState().addToast('error', translateUi('Could not resolve permission')),
  });
}
