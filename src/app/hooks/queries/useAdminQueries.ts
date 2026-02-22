import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../../services/apiClient';
import { useAuthStore } from '../../stores/useAuthStore';
import { useToastStore } from '../../stores/useToastStore';
import {
  AdminOverviewResponseSchema,
  AIConfigResponseSchema,
  AITestResponseSchema,
  ActivityResponseSchema,
  SessionsResponseSchema,
  ServerConfigResponseSchema,
  DataOverviewResponseSchema,
  PurgeResponseSchema,
  ReindexResponseSchema,
  BackupResponseSchema,
} from '../../types/schemas';
import { queryKeys } from './queryKeys';

// --- Queries ---

export function useAdminOverviewQuery() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  return useQuery({
    queryKey: queryKeys.adminOverview,
    queryFn: async () => {
      const res = await apiClient.get('/admin/overview');
      return AdminOverviewResponseSchema.parse(res.data);
    },
    enabled: !!serverUrl,
    refetchInterval: 30_000,
  });
}

export function useAdminAIQuery() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  return useQuery({
    queryKey: queryKeys.adminAI,
    queryFn: async () => {
      const res = await apiClient.get('/admin/ai');
      return AIConfigResponseSchema.parse(res.data);
    },
    enabled: !!serverUrl,
  });
}

export function useAdminActivityQuery() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  return useQuery({
    queryKey: queryKeys.adminActivity,
    queryFn: async () => {
      const res = await apiClient.get('/admin/activity');
      return ActivityResponseSchema.parse(res.data);
    },
    enabled: !!serverUrl,
  });
}

export function useAdminSessionsQuery() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  return useQuery({
    queryKey: queryKeys.adminSessions,
    queryFn: async () => {
      const res = await apiClient.get('/admin/sessions');
      return SessionsResponseSchema.parse(res.data);
    },
    enabled: !!serverUrl,
    refetchInterval: 10_000,
  });
}

export function useAdminConfigQuery() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  return useQuery({
    queryKey: queryKeys.adminConfig,
    queryFn: async () => {
      const res = await apiClient.get('/admin/config');
      return ServerConfigResponseSchema.parse(res.data);
    },
    enabled: !!serverUrl,
  });
}

export function useAdminDataQuery() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  return useQuery({
    queryKey: queryKeys.adminData,
    queryFn: async () => {
      const res = await apiClient.get('/admin/data');
      return DataOverviewResponseSchema.parse(res.data);
    },
    enabled: !!serverUrl,
  });
}

// --- Mutations ---

export function useTestAIConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.post('/admin/ai/test');
      return AITestResponseSchema.parse(res.data);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.adminAI });
      queryClient.invalidateQueries({ queryKey: queryKeys.adminOverview });
      const toast = useToastStore.getState();
      if (data.connected) {
        toast.addToast('success', `AI connected (${data.latency_ms}ms)`);
      } else {
        toast.addToast('error', `AI connection failed: ${data.error}`);
      }
    },
  });
}

export function useReindexFTS() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.post('/admin/db/reindex');
      return ReindexResponseSchema.parse(res.data);
    },
    onSuccess: () => {
      useToastStore.getState().addToast('success', 'FTS reindex completed');
      queryClient.invalidateQueries({ queryKey: queryKeys.adminOverview });
    },
  });
}

export function useBackupDatabase() {
  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.post('/admin/db/backup');
      return BackupResponseSchema.parse(res.data);
    },
    onSuccess: (data) => {
      useToastStore.getState().addToast('success', `Backup created: ${data.filename}`);
    },
  });
}

export function usePurgeData() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { target: string; older_than_days: number }) => {
      const res = await apiClient.post('/admin/db/purge', body);
      return PurgeResponseSchema.parse(res.data);
    },
    onSuccess: (data) => {
      useToastStore.getState().addToast('success', `Purged ${data.deleted_count} ${data.target}`);
      queryClient.invalidateQueries({ queryKey: queryKeys.adminOverview });
      queryClient.invalidateQueries({ queryKey: queryKeys.adminData });
      queryClient.invalidateQueries({ queryKey: queryKeys.adminActivity });
      queryClient.invalidateQueries({ queryKey: queryKeys.todos });
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    },
  });
}

export function useDisconnectSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiClient.post(`/admin/sessions/${userId}/disconnect`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.adminSessions });
      useToastStore.getState().addToast('success', 'Session disconnected');
    },
  });
}
