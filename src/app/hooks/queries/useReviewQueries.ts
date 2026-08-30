import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import apiClient from '../../services/apiClient';
import { useAuthStore } from '../../stores/useAuthStore';
import { useToastStore } from '../../stores/useToastStore';
import {
  ArtifactResponseSchema,
  ArtifactRevisionResponseSchema,
  AgentRunReviewOutcomeSchema,
  ReviewDecisionResponseSchema,
  ReviewItemResponseSchema,
} from '../../types/schemas';
import type {
  AgentRunReviewOutcome,
  ArtifactType,
  ReviewDecisionResponse,
  ReviewStatus,
} from '../../types/api';
import { queryKeys } from './queryKeys';
import { translateUi } from '../../i18n';
export type ReviewDecisionResult = ReviewDecisionResponse & {
  agentRunOutcome: AgentRunReviewOutcome | null;
};
export function useReviewsQuery(status: ReviewStatus = 'pending', projectId?: string | null) {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  return useQuery({
    queryKey: queryKeys.reviewList(status, projectId),
    queryFn: async () => {
      const response = await apiClient.get('/reviews', {
        params: { status, ...(projectId ? { project_id: projectId } : {}) },
      });
      return z.array(ReviewItemResponseSchema).parse(response.data);
    },
    enabled: !!serverUrl,
  });
}
export function useDecideReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      reviewId,
      decision,
      note,
    }: {
      reviewId: string;
      decision: Extract<ReviewStatus, 'approved' | 'changes_requested' | 'rejected'>;
      note?: string;
    }): Promise<ReviewDecisionResult> => {
      const response = await apiClient.post(`/reviews/${reviewId}/decision`, { decision, note });
      const parsed = ReviewDecisionResponseSchema.parse(response.data);
      const typedOutcome = AgentRunReviewOutcomeSchema.safeParse(parsed.outcome);
      const agentRunOutcome =
        parsed.review.subject_type === 'agent_run' && typedOutcome.success
          ? typedOutcome.data
          : null;
      return { ...parsed, agentRunOutcome };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.reviews });
      queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      queryClient.invalidateQueries({ queryKey: queryKeys.todos });
      queryClient.invalidateQueries({ queryKey: queryKeys.taskGraphInsights });
      queryClient.invalidateQueries({ queryKey: ['artifacts'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.runs });
      queryClient.invalidateQueries({ queryKey: queryKeys.taskExecutionTelemetry });
      const newlyReadyCount = result.agentRunOutcome?.newly_ready_tasks?.length ?? 0;
      const message =
        result.review.status === 'approved' && result.review.subject_type === 'agent_run'
          ? newlyReadyCount > 0
            ? `Agent result approved · ${newlyReadyCount} task${newlyReadyCount === 1 ? '' : 's'} now Ready`
            : 'Agent result approved'
          : 'Review decision saved';
      useToastStore.getState().addToast('success', message);
    },
    onError: () =>
      useToastStore.getState().addToast('error', translateUi('Could not save review decision')),
  });
}
export function useArtifactsQuery(projectId: string | undefined) {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  return useQuery({
    queryKey: queryKeys.artifacts(projectId ?? ''),
    queryFn: async () => {
      const response = await apiClient.get(`/projects/${projectId}/artifacts`);
      return z.array(ArtifactResponseSchema).parse(response.data);
    },
    enabled: !!serverUrl && !!projectId,
  });
}
export function useCreateArtifact(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { type: ArtifactType; title: string; content: string }) => {
      const response = await apiClient.post(`/projects/${projectId}/artifacts`, data);
      return ArtifactResponseSchema.parse(response.data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.artifacts(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.taskExecutionTelemetry });
      useToastStore.getState().addToast('success', translateUi('Artifact created'));
    },
    onError: () =>
      useToastStore.getState().addToast('error', translateUi('Could not create artifact')),
  });
}
export function useProposeArtifactRevision(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      artifactId,
      title,
      content,
    }: {
      artifactId: string;
      title?: string;
      content: string;
    }) => {
      const response = await apiClient.post(`/artifacts/${artifactId}/revisions`, {
        title,
        content,
      });
      return ArtifactRevisionResponseSchema.parse(response.data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.artifacts(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.reviews });
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.taskExecutionTelemetry });
      useToastStore.getState().addToast('success', translateUi('Revision sent to review'));
    },
    onError: () =>
      useToastStore.getState().addToast('error', translateUi('Could not propose revision')),
  });
}
