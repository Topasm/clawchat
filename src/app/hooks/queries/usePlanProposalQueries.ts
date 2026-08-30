import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import apiClient from '../../services/apiClient';
import { useAuthStore } from '../../stores/useAuthStore';
import { useToastStore } from '../../stores/useToastStore';
import {
  PlanApplyRequestSchema,
  PlanApplyResponseSchema,
  PlanDismissRequestSchema,
  PlanDismissResponseSchema,
  PlanGenerateRequestSchema,
  PlanProposalResponseSchema,
  PlanUndoResponseSchema,
  StalePlanProposalDetailsSchema,
} from '../../types/schemas';
import type {
  PlanApplyResponse,
  PlanProposalResponse,
  PlanSubtask,
  PlanUndoResponse,
  StalePlanProposalDetails,
} from '../../types/api';
import { queryKeys } from './queryKeys';
import { invalidateTaskDerivedQueries } from './invalidateTaskDerivedQueries';
import { translateUi } from '../../i18n';
export interface GeneratePlanProposalVariables {
  todoId: string;
  instructions?: string;
}
export interface ApplyPlanProposalVariables {
  todoId: string;
  proposalId: string;
  baseGraphRevision: number;
  selectedIndices?: number[];
  subtasks?: PlanSubtask[];
}
export interface DismissPlanProposalVariables {
  todoId: string;
  proposalId: string;
}
export interface PlanProposalMutationError {
  status?: number;
  code?: string;
  message: string;
  staleDetails?: StalePlanProposalDetails;
}
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}
/** Normalize both ClawChat and FastAPI error envelopes for inline proposal feedback. */
export function getPlanProposalMutationError(error: unknown): PlanProposalMutationError {
  const errorRecord = asRecord(error);
  const response = asRecord(errorRecord?.response);
  const status = typeof response?.status === 'number' ? response.status : undefined;
  const data = asRecord(response?.data);
  const errorEnvelope = asRecord(data?.error);
  const code = typeof errorEnvelope?.code === 'string' ? errorEnvelope.code : undefined;
  const staleDetailsResult = StalePlanProposalDetailsSchema.safeParse(errorEnvelope?.details);
  let message =
    typeof errorEnvelope?.message === 'string'
      ? errorEnvelope.message
      : typeof data?.detail === 'string'
        ? data.detail
        : typeof errorRecord?.message === 'string'
          ? errorRecord.message
          : 'The plan request failed';
  if (Array.isArray(data?.detail)) {
    const firstDetail = asRecord(data.detail[0]);
    if (typeof firstDetail?.msg === 'string') message = firstDetail.msg;
  }
  return {
    status,
    code,
    message,
    staleDetails: staleDetailsResult.success ? staleDetailsResult.data : undefined,
  };
}
export function isStalePlanProposalError(error: unknown): boolean {
  const normalized = getPlanProposalMutationError(error);
  return normalized.status === 409 && normalized.code === 'STALE_PLAN_PROPOSAL';
}
async function invalidatePlanData(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.planProposals }),
    queryClient.invalidateQueries({ queryKey: queryKeys.todos }),
    queryClient.invalidateQueries({ queryKey: queryKeys.today }),
    queryClient.invalidateQueries({ queryKey: queryKeys.taskRelationships }),
    queryClient.invalidateQueries({ queryKey: queryKeys.reviews }),
    queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
    invalidateTaskDerivedQueries(queryClient),
  ]);
}
async function revertPlanChangeSet(changeSetId: string): Promise<PlanUndoResponse> {
  const response = await apiClient.post(`/change-sets/${changeSetId}/revert`, undefined, {
    queueOfflineMutation: false,
  });
  return PlanUndoResponseSchema.parse(response.data);
}
export function useLatestPlanProposalQuery(todoId?: string, enabled = true) {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  return useQuery({
    queryKey: queryKeys.latestPlanProposal(todoId ?? ''),
    queryFn: async (): Promise<PlanProposalResponse> => {
      const response = await apiClient.get(`/todos/${todoId}/plan/latest`);
      return PlanProposalResponseSchema.parse(response.data);
    },
    enabled: Boolean(serverUrl && todoId && enabled),
    retry: false,
  });
}
export function useGeneratePlanProposal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      todoId,
      instructions,
    }: GeneratePlanProposalVariables): Promise<PlanProposalResponse> => {
      const response = await apiClient.post(
        `/todos/${todoId}/plan/generate`,
        PlanGenerateRequestSchema.parse({ instructions: instructions?.trim() || null }),
        { queueOfflineMutation: false },
      );
      return PlanProposalResponseSchema.parse(response.data);
    },
    onSuccess: (proposal, variables) => {
      queryClient.setQueryData(queryKeys.latestPlanProposal(variables.todoId), proposal);
      queryClient.setQueryData(queryKeys.planProposal(proposal.proposal_id), proposal);
    },
    onError: (error) => {
      useToastStore
        .getState()
        .addToast(
          'error',
          getPlanProposalMutationError(error).message ||
            translateUi('AI could not generate a task plan'),
        );
    },
    onSettled: () => invalidatePlanData(queryClient),
  });
}
export function useApplyPlanProposal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      todoId,
      proposalId,
      baseGraphRevision,
      selectedIndices,
      subtasks,
    }: ApplyPlanProposalVariables): Promise<PlanApplyResponse> => {
      const body = PlanApplyRequestSchema.parse({
        proposal_id: proposalId,
        base_graph_revision: baseGraphRevision,
        selected_indices: selectedIndices,
        subtasks,
      });
      const response = await apiClient.post(`/todos/${todoId}/plan/apply`, body, {
        queueOfflineMutation: false,
      });
      return PlanApplyResponseSchema.parse(response.data);
    },
    onSuccess: (result) => {
      const created = result.created_subtask_ids.length;
      useToastStore.getState().addToast(
        'success',
        result.already_applied
          ? translateUi('This proposal was already applied')
          : translateUi('Created {{count}} tasks', { count: created }),
        result.can_undo
          ? {
              duration: 10000,
              action: {
                label: translateUi('Undo'),
                onClick: () => {
                  void (async () => {
                    try {
                      const undoResult = await revertPlanChangeSet(result.change_set_id);
                      await invalidatePlanData(queryClient);
                      useToastStore
                        .getState()
                        .addToast(
                          'success',
                          undoResult.already_reverted
                            ? translateUi('Plan was already undone')
                            : translateUi('Plan changes undone'),
                        );
                    } catch (error) {
                      useToastStore
                        .getState()
                        .addToast('error', getPlanProposalMutationError(error).message);
                    }
                  })();
                },
              },
            }
          : undefined,
      );
    },
    onError: (error) => {
      if (isStalePlanProposalError(error)) return;
      useToastStore.getState().addToast('error', getPlanProposalMutationError(error).message);
    },
    onSettled: () => invalidatePlanData(queryClient),
  });
}
export function useDismissPlanProposal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ todoId, proposalId }: DismissPlanProposalVariables) => {
      const body = PlanDismissRequestSchema.parse({ proposal_id: proposalId });
      const response = await apiClient.post(`/todos/${todoId}/plan/dismiss`, body, {
        queueOfflineMutation: false,
      });
      return PlanDismissResponseSchema.parse(response.data);
    },
    onError: (error) => {
      useToastStore.getState().addToast('error', getPlanProposalMutationError(error).message);
    },
    onSettled: () => invalidatePlanData(queryClient),
  });
}
export function useRevertPlanChangeSet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: revertPlanChangeSet,
    onSuccess: (result) => {
      useToastStore
        .getState()
        .addToast(
          'success',
          translateUi(result.already_reverted ? 'Plan was already undone' : 'Plan changes undone'),
        );
    },
    onError: (error) => {
      useToastStore.getState().addToast('error', getPlanProposalMutationError(error).message);
    },
    onSettled: () => invalidatePlanData(queryClient),
  });
}
