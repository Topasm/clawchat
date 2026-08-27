import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import apiClient from '../../services/apiClient';
import { useAuthStore } from '../../stores/useAuthStore';
import { useToastStore } from '../../stores/useToastStore';
import { AgentRunEventResponseSchema, AgentRunResponseSchema } from '../../types/schemas';
import type { AgentRunResponse } from '../../types/api';
import { queryKeys } from './queryKeys';

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
      return runs?.some((run) => ACTIVE.has(run.status)) ? 3_000 : false;
    },
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
      useToastStore.getState().addToast('success', 'Agent run cancelled');
    },
    onError: () => useToastStore.getState().addToast('error', 'Could not cancel agent run'),
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
      useToastStore.getState().addToast('success', 'New agent attempt started');
    },
    onError: () => useToastStore.getState().addToast('error', 'Could not retry agent run'),
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
      useToastStore.getState().addToast('success', 'Agent run resumed');
    },
    onError: () => useToastStore.getState().addToast('error', 'Could not resume agent run'),
  });
}
