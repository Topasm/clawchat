import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import apiClient from '../../services/apiClient';
import { useAuthStore } from '../../stores/useAuthStore';
import { useToastStore } from '../../stores/useToastStore';
import { ExecutionProviderStatusSchema } from '../../types/schemas';
import { queryKeys } from './queryKeys';
import { translateUi } from '../../i18n';
export function useExecutionProvidersQuery(enabled = true) {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  return useQuery({
    queryKey: queryKeys.executionProviders,
    queryFn: async () => {
      const response = await apiClient.get('/execution-providers');
      return z.array(ExecutionProviderStatusSchema).parse(response.data);
    },
    enabled: !!serverUrl && enabled,
    staleTime: 30000,
  });
}
/** Re-check one execution provider's health and update the cached list. */
export function useTestExecutionProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (providerId: string) => {
      const response = await apiClient.post(`/execution-providers/${providerId}/test`);
      return ExecutionProviderStatusSchema.parse(response.data);
    },
    onSuccess: (status) => {
      queryClient.setQueryData(queryKeys.executionProviders, (current: unknown) => {
        const providers = z.array(ExecutionProviderStatusSchema).safeParse(current);
        if (!providers.success) return current;
        return providers.data.map((provider) => (provider.id === status.id ? status : provider));
      });
      useToastStore.getState().addToast(
        status.connected ? 'success' : 'warning',
        translateUi(status.connected ? '{{name}} connected' : '{{name}} unavailable', {
          name: status.label,
        }),
      );
    },
    onError: () =>
      useToastStore.getState().addToast('error', translateUi('Connection test failed')),
  });
}
