import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../../services/apiClient';
import { useAuthStore } from '../../stores/useAuthStore';
import {
  ObsidianStatusSchema,
  ObsidianHealthSchema,
  ObsidianProjectsResponseSchema,
  ObsidianScanResultSchema,
} from '../../types/schemas';
import type {
  ObsidianStatus,
  ObsidianHealth,
  ObsidianProjectsResponse,
  ObsidianScanResult,
} from '../../types/schemas';
import { queryKeys } from './queryKeys';

// ---------------------------------------------------------------------------
// Query hooks
// ---------------------------------------------------------------------------

export function useObsidianStatusQuery() {
  const serverUrl = useAuthStore((s) => s.serverUrl);

  return useQuery<ObsidianStatus>({
    queryKey: queryKeys.obsidianStatus,
    queryFn: async () => {
      const res = await apiClient.get('/obsidian/status');
      return ObsidianStatusSchema.parse(res.data);
    },
    enabled: !!serverUrl,
    staleTime: 30_000,
  });
}

export function useObsidianHealthQuery(enabled = true) {
  const serverUrl = useAuthStore((s) => s.serverUrl);

  return useQuery<ObsidianHealth>({
    queryKey: queryKeys.obsidianHealth,
    queryFn: async () => {
      const res = await apiClient.get('/obsidian/health');
      return ObsidianHealthSchema.parse(res.data);
    },
    enabled: !!serverUrl && enabled,
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
}

export function useObsidianProjectsQuery(enabled = true) {
  const serverUrl = useAuthStore((s) => s.serverUrl);

  return useQuery<ObsidianProjectsResponse>({
    queryKey: queryKeys.obsidianProjects,
    queryFn: async () => {
      const res = await apiClient.get('/obsidian/projects');
      return ObsidianProjectsResponseSchema.parse(res.data);
    },
    enabled: !!serverUrl && enabled,
    staleTime: 60_000,
  });
}

export function useObsidianSyncStatusQuery(enabled = true) {
  const serverUrl = useAuthStore((s) => s.serverUrl);

  return useQuery({
    queryKey: queryKeys.obsidianSyncStatus,
    queryFn: async () => {
      const res = await apiClient.get('/obsidian/sync-status');
      return res.data;
    },
    enabled: !!serverUrl && enabled,
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Mutation hooks
// ---------------------------------------------------------------------------

export function useObsidianSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.post('/obsidian/sync');
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.obsidianStatus });
      qc.invalidateQueries({ queryKey: queryKeys.obsidianHealth });
    },
  });
}

export function useObsidianReindex() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.post('/obsidian/reindex');
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.obsidianProjects });
      qc.invalidateQueries({ queryKey: queryKeys.obsidianHealth });
    },
  });
}

export function useObsidianScan() {
  const qc = useQueryClient();
  return useMutation<ObsidianScanResult>({
    mutationFn: async () => {
      const res = await apiClient.post('/obsidian/scan');
      return ObsidianScanResultSchema.parse(res.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.obsidianSyncStatus });
      qc.invalidateQueries({ queryKey: queryKeys.obsidianHealth });
      qc.invalidateQueries({ queryKey: queryKeys.todos });
    },
  });
}

export function useObsidianFlushQueue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.post('/obsidian/queue/flush');
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.obsidianQueue });
      qc.invalidateQueries({ queryKey: queryKeys.obsidianHealth });
    },
  });
}

export function useObsidianRetryDeadLetter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.post('/obsidian/dead-letter/retry');
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.obsidianHealth });
    },
  });
}
