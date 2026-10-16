import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '../../services/apiClient';
import { useAuthStore } from '../../stores/useAuthStore';
import { useToastStore } from '../../stores/useToastStore';
import { translateUi } from '../../i18n';
import { TodaySuggestionListSchema, TodaySuggestionSchema } from '../../types/schemas';
import { invalidateModuleQueries } from './invalidateModuleQueries';
import { queryKeys } from './queryKeys';

export function useTodaySuggestionsQuery() {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  return useQuery({
    queryKey: queryKeys.todaySuggestions,
    queryFn: async () =>
      TodaySuggestionListSchema.parse((await apiClient.get('/today/suggestions')).data),
    enabled: !!serverUrl,
  });
}

export type SuggestionAnswer = 'accept' | 'dismiss' | 'undo';

/** Add, dismiss, or undo one suggestion; whatever it made shows up at once. */
export function useAnswerTodaySuggestion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, answer }: { id: string; answer: SuggestionAnswer }) =>
      TodaySuggestionSchema.parse(
        (await apiClient.post(`/today/suggestions/${id}/${answer}`)).data,
      ),
    onError: () =>
      useToastStore.getState().addToast('error', translateUi('Could not update the suggestion.')),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.todaySuggestions });
      void queryClient.invalidateQueries({ queryKey: queryKeys.today });
      for (const module of ['todos', 'events', 'notes']) {
        invalidateModuleQueries(queryClient, module);
      }
    },
  });
}

export function useSetSuggestionAutoAdd() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (autoAdd: boolean) =>
      (await apiClient.put('/today/suggestions/settings', { auto_add: autoAdd })).data as {
        auto_add: boolean;
      },
    onError: () =>
      useToastStore.getState().addToast('error', translateUi('Could not save the setting.')),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.todaySuggestions });
    },
  });
}
