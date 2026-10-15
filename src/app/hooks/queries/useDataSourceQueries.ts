import { useQuery } from '@tanstack/react-query';
import apiClient from '../../services/apiClient';
import { useAuthStore } from '../../stores/useAuthStore';
import {
  DataSourceQueryLogSchema,
  DataSourceQueryResponseSchema,
  DataSourceResponseSchema,
  type DataSourceQueryResult,
} from '../../types/schemas';
import { queryKeys } from './queryKeys';

export interface DataSourceRequest {
  op: 'list' | 'read' | 'search';
  path?: string;
  query?: string;
}

/** The server's word for why a request was refused, if it gave one. */
export function dataSourceErrorReason(error: unknown): {
  code: string | null;
  reason: string | null;
  message: string | null;
} {
  const body = (
    error as {
      response?: {
        data?: { error?: { code?: string; message?: string; details?: { reason?: string } } };
      };
    }
  ).response?.data?.error;
  return {
    code: body?.code ?? null,
    reason: body?.details?.reason ?? null,
    message: body?.message ?? null,
  };
}

export function useDataSourcesQuery() {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  return useQuery({
    queryKey: queryKeys.dataSources,
    queryFn: async () =>
      DataSourceResponseSchema.array().parse((await apiClient.get('/data-sources')).data),
    enabled: !!serverUrl,
    // Online state is the machine asking for requests; keep it current
    // without the user having to come back to the page.
    refetchInterval: 30_000,
  });
}

/**
 * One relayed request. The server waits for the machine that holds the data,
 * so this can take a few seconds; a listing falls back to the index Home
 * keeps when the machine is off or slow, a read does not.
 */
export function useDataSourceQuery(sourceId: string | null, request: DataSourceRequest | null) {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  return useQuery<DataSourceQueryResult>({
    queryKey: queryKeys.dataSourceQuery(
      sourceId ?? '',
      request?.op ?? '',
      request?.path ?? '',
      request?.query ?? '',
    ),
    queryFn: async () =>
      DataSourceQueryResponseSchema.parse(
        (
          await apiClient.post(`/data-sources/${sourceId}/query`, request, {
            // The server gives the machine 15 seconds before falling back.
            timeout: 30_000,
          })
        ).data,
      ),
    enabled: !!serverUrl && !!sourceId && !!request,
    retry: false,
    staleTime: 15_000,
  });
}

export function useDataSourceLogQuery(sourceId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.dataSourceLog(sourceId ?? ''),
    queryFn: async () =>
      DataSourceQueryLogSchema.array().parse(
        (await apiClient.get(`/data-sources/${sourceId}/queries`, { params: { limit: 30 } })).data,
      ),
    enabled: !!sourceId && enabled,
  });
}
