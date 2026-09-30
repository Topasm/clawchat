import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '../../services/apiClient';
import { useAuthStore } from '../../stores/useAuthStore';
import { useToastStore } from '../../stores/useToastStore';
import { translateUi } from '../../i18n';
import {
  ScheduledJobListResponseSchema,
  ScheduledJobResponseSchema,
  ScheduledJobRunResponseSchema,
  type ScheduledJob,
} from '../../types/schemas';
import { queryKeys } from './queryKeys';

export interface ScheduledJobInput {
  title: string;
  instruction: string;
  skill_chain: string[];
  project_id: string | null;
  include_task_snapshot: boolean;
  rrule: string;
  timezone: string;
  enabled: boolean;
}

function serverMessage(error: unknown, fallback: string): string {
  const message = (error as { response?: { data?: { error?: { message?: string } } } }).response
    ?.data?.error?.message;
  return message ?? fallback;
}

function useJobMutation<TVariables, TResult>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
  messages: { success?: string; failure: string },
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      if (messages.success) useToastStore.getState().addToast('success', messages.success);
    },
    onError: (error) => {
      useToastStore.getState().addToast('error', serverMessage(error, messages.failure));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.scheduledJobs });
    },
  });
}

export function useScheduledJobsQuery() {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  return useQuery({
    queryKey: queryKeys.scheduledJobs,
    queryFn: async () =>
      ScheduledJobListResponseSchema.parse((await apiClient.get('/scheduled-jobs')).data).jobs,
    enabled: !!serverUrl,
  });
}

export function useCreateScheduledJob() {
  return useJobMutation(
    async (input: ScheduledJobInput): Promise<ScheduledJob> =>
      ScheduledJobResponseSchema.parse((await apiClient.post('/scheduled-jobs', input)).data),
    {
      success: translateUi('Scheduled job created'),
      failure: translateUi('Could not save the scheduled job.'),
    },
  );
}

export function useUpdateScheduledJob() {
  return useJobMutation(
    async ({ id, changes }: { id: string; changes: Partial<ScheduledJobInput> }) =>
      ScheduledJobResponseSchema.parse(
        (await apiClient.patch(`/scheduled-jobs/${id}`, changes)).data,
      ),
    { failure: translateUi('Could not save the scheduled job.') },
  );
}

export function useDeleteScheduledJob() {
  return useJobMutation(
    async (id: string) => {
      await apiClient.delete(`/scheduled-jobs/${id}`);
    },
    {
      success: translateUi('Scheduled job deleted'),
      failure: translateUi('Could not delete the scheduled job.'),
    },
  );
}

export function useRunScheduledJobNow() {
  return useJobMutation(
    async (id: string) =>
      ScheduledJobRunResponseSchema.parse((await apiClient.post(`/scheduled-jobs/${id}/run`)).data),
    {
      success: translateUi('Job started. Its result will appear in Attention.'),
      failure: translateUi('Could not start the job.'),
    },
  );
}
