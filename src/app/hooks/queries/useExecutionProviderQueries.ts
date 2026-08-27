import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import apiClient from '../../services/apiClient';
import { useAuthStore } from '../../stores/useAuthStore';
import { useToastStore } from '../../stores/useToastStore';
import { ExecutionProviderStatusSchema } from '../../types/schemas';
import { queryKeys } from './queryKeys';

export function useExecutionProvidersQuery() {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  return useQuery({
    queryKey: queryKeys.executionProviders,
    queryFn: async () => {
      const response = await apiClient.get('/execution-providers');
      return z.array(ExecutionProviderStatusSchema).parse(response.data);
    },
    enabled: !!serverUrl,
    staleTime: 30_000,
  });
}

export function useTestPaseoConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await apiClient.post('/execution-providers/paseo/test');
      return ExecutionProviderStatusSchema.parse(response.data);
    },
    onSuccess: (status) => {
      queryClient.setQueryData(queryKeys.executionProviders, (current: unknown) => {
        const providers = z.array(ExecutionProviderStatusSchema).safeParse(current);
        if (!providers.success) return current;
        return providers.data.map((provider) => (provider.id === 'paseo' ? status : provider));
      });
      useToastStore
        .getState()
        .addToast(
          status.connected ? 'success' : 'warning',
          status.connected ? 'Paseo connected' : 'Paseo unavailable',
        );
    },
    onError: () => useToastStore.getState().addToast('error', 'Paseo connection test failed'),
  });
}
