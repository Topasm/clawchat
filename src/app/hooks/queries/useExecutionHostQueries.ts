import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import apiClient from '../../services/apiClient';
import { useAuthStore } from '../../stores/useAuthStore';
import { queryKeys } from './queryKeys';

/** A machine registered to run work. */
export const ExecutionHostSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.string(),
  target: z.string().nullable().optional(),
  platform: z.string().nullable().optional(),
  is_enabled: z.boolean(),
  last_seen_at: z.string().nullable().optional(),
});

export type ExecutionHost = z.infer<typeof ExecutionHostSchema>;

export const ProjectWorkspaceSchema = z.object({
  host_id: z.string().nullable().optional(),
  host_label: z.string().nullable().optional(),
  path: z.string().nullable().optional(),
  is_available: z.boolean(),
  /** Known machine, unreachable now — work aimed at it is refused, not queued. */
  is_offline: z.boolean(),
  is_unconfigured: z.boolean(),
  paths: z.array(z.object({ host_id: z.string(), path: z.string() })),
});

export type ProjectWorkspace = z.infer<typeof ProjectWorkspaceSchema>;

export function useExecutionHostsQuery() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  return useQuery({
    queryKey: queryKeys.executionHosts,
    queryFn: async () => {
      const res = await apiClient.get('/execution-hosts');
      return z.array(ExecutionHostSchema).parse(res.data ?? []);
    },
    enabled: !!serverUrl,
    // A worker drops off the list by going quiet, so this goes stale on its own.
    refetchInterval: 60_000,
  });
}

export function useProjectWorkspaceQuery(projectId: string | undefined) {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  return useQuery({
    queryKey: queryKeys.projectWorkspace(projectId ?? ''),
    queryFn: async () => {
      const res = await apiClient.get(`/projects/${projectId}/workspace`);
      return ProjectWorkspaceSchema.parse(res.data);
    },
    enabled: !!serverUrl && !!projectId,
    refetchInterval: 60_000,
  });
}

function useWorkspaceMutation<TVariables>(
  projectId: string,
  request: (variables: TVariables) => Promise<unknown>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projectWorkspace(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
    },
  });
}

/** Record where this project lives on one machine. */
export function useSetProjectHostPath(projectId: string) {
  return useWorkspaceMutation<{ host_id: string; path: string }>(projectId, (body) =>
    apiClient.put(`/projects/${projectId}/workspace/paths`, body),
  );
}

/** Choose the machine this project's work runs on. */
export function useSetProjectExecutionHost(projectId: string) {
  return useWorkspaceMutation<{ host_id: string }>(projectId, (body) =>
    apiClient.put(`/projects/${projectId}/workspace/host`, body),
  );
}

export function useDeleteProjectHostPath(projectId: string) {
  return useWorkspaceMutation<string>(projectId, (hostId) =>
    apiClient.delete(`/projects/${projectId}/workspace/paths/${hostId}`),
  );
}
