import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '../../services/apiClient';
import { useAuthStore } from '../../stores/useAuthStore';
import { useToastStore } from '../../stores/useToastStore';
import { translateUi } from '../../i18n';
import {
  CalendarAccountListResponseSchema,
  CalendarAccountResponseSchema,
  CalendarSourceResponseSchema,
} from '../../types/schemas';
import { queryKeys } from './queryKeys';

export interface CalendarAccountInput {
  label: string;
  server_url: string;
  username: string;
  password: string;
}

function serverMessage(error: unknown, fallback: string): string {
  const message = (error as { response?: { data?: { error?: { message?: string } } } }).response
    ?.data?.error?.message;
  return message ?? fallback;
}

function useSyncMutation<TVariables, TResult>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
  failure: string,
  success?: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      if (success) useToastStore.getState().addToast('success', success);
    },
    onError: (error) => useToastStore.getState().addToast('error', serverMessage(error, failure)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.calendarAccounts });
      void queryClient.invalidateQueries({ queryKey: queryKeys.events });
    },
  });
}

export function useCalendarAccountsQuery() {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  return useQuery({
    queryKey: queryKeys.calendarAccounts,
    queryFn: async () =>
      CalendarAccountListResponseSchema.parse((await apiClient.get('/calendar-sync/accounts')).data)
        .accounts,
    enabled: !!serverUrl,
  });
}

export function useConnectCalendarAccount() {
  return useSyncMutation(
    async (input: CalendarAccountInput) =>
      CalendarAccountResponseSchema.parse(
        (await apiClient.post('/calendar-sync/accounts', input)).data,
      ),
    translateUi('Could not connect the calendar account.'),
    translateUi('Calendar account connected'),
  );
}

export function useDeleteCalendarAccount() {
  return useSyncMutation(
    async (id: string) => {
      await apiClient.delete(`/calendar-sync/accounts/${id}`);
    },
    translateUi('Could not remove the calendar account.'),
    translateUi('Calendar account removed'),
  );
}

export function useSyncCalendarAccount() {
  return useSyncMutation(
    async (id: string) =>
      CalendarAccountResponseSchema.parse(
        (await apiClient.post(`/calendar-sync/accounts/${id}/sync`)).data,
      ),
    translateUi('Could not sync the calendar account.'),
  );
}

export function useUpdateCalendarSource() {
  return useSyncMutation(
    async ({
      id,
      changes,
    }: {
      id: string;
      changes: { import_enabled?: boolean; is_write_target?: boolean };
    }) =>
      CalendarSourceResponseSchema.parse(
        (await apiClient.patch(`/calendar-sync/calendars/${id}`, changes)).data,
      ),
    translateUi('Could not update the calendar.'),
  );
}
