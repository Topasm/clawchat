import { useQuery } from '@tanstack/react-query';
import apiClient from '../../services/apiClient';
import { useAuthStore } from '../../stores/useAuthStore';
import { CapabilitiesResponseSchema } from '../../types/schemas';
import type { CapabilitiesResponse } from '../../types/api';
import { queryKeys } from './queryKeys';

export function useCapabilitiesQuery() {
  const serverUrl = useAuthStore((s) => s.serverUrl);

  return useQuery<CapabilitiesResponse>({
    queryKey: queryKeys.capabilities,
    queryFn: async () => {
      const res = await apiClient.get('/capabilities');
      return CapabilitiesResponseSchema.parse(res.data);
    },
    enabled: !!serverUrl,
    staleTime: Infinity,
  });
}
