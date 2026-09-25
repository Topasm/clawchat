import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import apiClient from '../../services/apiClient';
import { useAuthStore } from '../../stores/useAuthStore';

export const CliSessionSchema = z.object({
  id: z.string(),
  provider: z.enum(['codex', 'claude']),
  title: z.string(),
  cwd: z.string(),
  status: z.enum(['running', 'waiting_input', 'idle', 'completed', 'failed', 'stopped', 'unknown']),
  kind: z.enum(['interactive', 'background', 'history']),
  updated_at: z.number().nullable(),
  waiting_for: z.string().nullable(),
  can_send: z.boolean(),
  can_stop: z.boolean(),
  can_restart: z.boolean(),
  can_read: z.boolean(),
  resume_command: z.string().nullable(),
});
export type CliSession = z.infer<typeof CliSessionSchema>;
const ListSchema = z.object({
  sessions: z.array(CliSessionSchema),
  providers: z.array(
    z.object({
      provider: z.enum(['codex', 'claude']),
      connected: z.boolean(),
      message: z.string().nullable(),
    }),
  ),
});
const DetailSchema = z.object({ session: CliSessionSchema, output: z.string() });
const key = ['cli-sessions'] as const;
const path = (session: Pick<CliSession, 'provider' | 'id'>) =>
  `/cli-sessions/${session.provider}/${encodeURIComponent(session.id)}`;

export function useCliSessionsQuery() {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  return useQuery({
    queryKey: [...key, serverUrl],
    enabled: !!serverUrl,
    queryFn: async () => ListSchema.parse((await apiClient.get('/cli-sessions')).data),
    refetchInterval: 5000,
    retry: false,
  });
}

export function useCliSessionDetailQuery(session: CliSession | null) {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  return useQuery({
    queryKey: [...key, serverUrl, session?.provider, session?.id],
    enabled: !!serverUrl && !!session,
    queryFn: async () => DetailSchema.parse((await apiClient.get(path(session!))).data),
    refetchInterval:
      session?.status === 'running' || session?.status === 'waiting_input' ? 5000 : false,
    retry: false,
  });
}

export function useCliSessionAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      session,
      action,
      message,
    }: {
      session: CliSession;
      action: 'message' | 'stop' | 'restart';
      message?: string;
    }) => {
      const response = await apiClient.post(`${path(session)}/actions`, { action, message });
      return z.object({ accepted: z.literal(true) }).parse(response.data);
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: key });
    },
    retry: false,
  });
}
