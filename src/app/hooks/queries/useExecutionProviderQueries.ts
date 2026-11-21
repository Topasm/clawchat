import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import apiClient from '../../services/apiClient';
import { useAuthStore } from '../../stores/useAuthStore';
import { useToastStore } from '../../stores/useToastStore';
import { ExecutionProviderStatusSchema, OrcaRepositorySchema } from '../../types/schemas';
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

/** The repositories Orca knows on the server's machine, for the project picker. */
export function useOrcaRepositoriesQuery(enabled: boolean) {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  return useQuery({
    queryKey: queryKeys.orcaRepositories,
    queryFn: async () => {
      const response = await apiClient.get('/execution-providers/orca/repositories');
      return z.array(OrcaRepositorySchema).parse(response.data);
    },
    enabled: !!serverUrl && enabled,
    staleTime: 30000,
  });
}

/**
 * Run a project's work with Orca in one of its repositories: the server
 * records the folder on its own machine and makes Orca the project's provider.
 */
export function useChooseOrcaRepository(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (path: string) => {
      await apiClient.put(`/projects/${projectId}/workspace/orca`, { path });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      queryClient.invalidateQueries({ queryKey: queryKeys.projectWorkspace(projectId) });
      useToastStore.getState().addToast('success', translateUi('Project updated'));
    },
    onError: () =>
      useToastStore.getState().addToast('error', translateUi('Could not save project settings')),
  });
}
