import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '../../services/apiClient';
import { useToastStore } from '../../stores/useToastStore';
import { queryKeys } from './queryKeys';

/** What the server will tell us about an existing subscription. */
export interface CalendarSubscriptionStatus {
  active: boolean;
  created_at?: string | null;
  last_used_at?: string | null;
}

/**
 * The status plus the URLs, which only ever come back from a create.
 *
 * The server stores a hash, so it cannot show the URL again later. Whatever the
 * user does not copy now is only recoverable by issuing a new one.
 */
export interface CalendarSubscriptionSecret extends CalendarSubscriptionStatus {
  url: string;
  webcal_url: string;
}

export function useCalendarSubscriptionQuery(enabled = true) {
  return useQuery<CalendarSubscriptionStatus>({
    queryKey: queryKeys.calendarSubscription,
    queryFn: async () => {
      const response = await apiClient.get('/events/subscription');
      return response.data as CalendarSubscriptionStatus;
    },
    enabled,
  });
}

export function useCreateCalendarSubscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await apiClient.post('/events/subscription');
      return response.data as CalendarSubscriptionSecret;
    },
    onSuccess: () => {
      useToastStore.getState().addToast('success', 'Subscription URL created');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.calendarSubscription });
    },
  });
}

export function useRevokeCalendarSubscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await apiClient.delete('/events/subscription');
    },
    onSuccess: () => {
      useToastStore.getState().addToast('success', 'Subscription revoked');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.calendarSubscription });
    },
  });
}
