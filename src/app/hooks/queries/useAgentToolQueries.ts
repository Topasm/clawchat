import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '../../services/apiClient';
import { useAuthStore } from '../../stores/useAuthStore';
import { useToastStore } from '../../stores/useToastStore';
import { translateUi } from '../../i18n';
import {
  AgentToolSettingsResponseSchema,
  McpServerListResponseSchema,
  McpServerResponseSchema,
  SearxngTestResponseSchema,
} from '../../types/schemas';
import { queryKeys } from './queryKeys';

export type ToolTrust = 'read_only' | 'approval';

export interface McpServerInput {
  name: string;
  transport: 'stdio' | 'http';
  command?: string | null;
  args?: string[];
  env?: Record<string, string | null>;
  url?: string | null;
  headers?: Record<string, string | null>;
  trust?: ToolTrust;
  enabled?: boolean;
}

function serverMessage(error: unknown, fallback: string): string {
  const message = (error as { response?: { data?: { error?: { message?: string } } } }).response
    ?.data?.error?.message;
  return message ?? fallback;
}

function toastError(fallback: string) {
  return (error: unknown) =>
    useToastStore.getState().addToast('error', serverMessage(error, fallback));
}

export function useAgentToolSettingsQuery() {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  return useQuery({
    queryKey: queryKeys.agentToolSettings,
    queryFn: async () =>
      AgentToolSettingsResponseSchema.parse((await apiClient.get('/agent-tools/settings')).data),
    enabled: !!serverUrl,
  });
}

export function useSaveSearxngUrl() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (url: string | null) =>
      AgentToolSettingsResponseSchema.parse(
        (await apiClient.put('/agent-tools/settings', { searxng_url: url })).data,
      ),
    onSuccess: () =>
      useToastStore.getState().addToast('success', translateUi('Web search settings saved')),
    onError: toastError(translateUi('Could not save the web search settings.')),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.agentToolSettings }),
  });
}

export function useTestSearxng() {
  return useMutation({
    mutationFn: async (url: string) =>
      SearxngTestResponseSchema.parse(
        (await apiClient.post('/agent-tools/searxng/test', { url })).data,
      ),
  });
}

export function useMcpServersQuery() {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  return useQuery({
    queryKey: queryKeys.mcpServers,
    queryFn: async () =>
      McpServerListResponseSchema.parse((await apiClient.get('/agent-tools/mcp-servers')).data)
        .servers,
    enabled: !!serverUrl,
  });
}

function useServerMutation<TVariables>(
  mutationFn: (variables: TVariables) => Promise<unknown>,
  failure: string,
  success?: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      if (success) useToastStore.getState().addToast('success', success);
    },
    onError: toastError(failure),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers }),
  });
}

export function useCreateMcpServer() {
  return useServerMutation(
    async (input: McpServerInput) =>
      McpServerResponseSchema.parse((await apiClient.post('/agent-tools/mcp-servers', input)).data),
    translateUi('Could not add the MCP server.'),
  );
}

export function useUpdateMcpServer() {
  return useServerMutation(
    async ({ id, changes }: { id: string; changes: Partial<McpServerInput> }) =>
      McpServerResponseSchema.parse(
        (await apiClient.patch(`/agent-tools/mcp-servers/${id}`, changes)).data,
      ),
    translateUi('Could not update the MCP server.'),
  );
}

export function useRefreshMcpServer() {
  return useServerMutation(
    async (id: string) =>
      McpServerResponseSchema.parse(
        (await apiClient.post(`/agent-tools/mcp-servers/${id}/refresh`)).data,
      ),
    translateUi('Could not reach the MCP server.'),
  );
}

export function useDeleteMcpServer() {
  return useServerMutation(
    async (id: string) => {
      await apiClient.delete(`/agent-tools/mcp-servers/${id}`);
    },
    translateUi('Could not remove the MCP server.'),
    translateUi('MCP server removed'),
  );
}

export function useDecideToolCall() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      runId,
      callId,
      decision,
    }: {
      runId: string;
      callId: string;
      decision: 'allow' | 'deny';
    }) => {
      await apiClient.post(`/runs/${runId}/tool-calls/${callId}/decision`, { decision });
    },
    onError: toastError(translateUi('That request is no longer waiting for a decision.')),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.runs }),
  });
}
